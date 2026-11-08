#!/usr/bin/env python3
"""Explicit, credential-safe TNT smoke tests; never run as part of pytest."""
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo
from xml.etree import ElementTree as ET

import httpx
from defusedxml import ElementTree as SafeET

ROOT = Path(__file__).resolve().parents[1]
RTT_URL = "https://www.tntexpress.com.au/Rtt/inputRequest.asp"
TRACK_URL = "https://express.tnt.com/expressconnect/track.do?version=3"
PRICING_URL = "https://express.tnt.com/expressconnect/pricing/getprice"
TIMEOUT = httpx.Timeout(25.0, connect=10.0)


@dataclass
class SmokeResult:
    case_id: str
    endpoint: str
    http_status: int | None = None
    response_content_type: str | None = None
    authentication_result: str = "NOT_TESTED"
    api_business_result: str = "NOT_TESTED"
    parsed: dict[str, Any] | list[Any] | None = None
    failure_category: str = "NOT_TESTED"
    safe_error_summary: str | None = None


def _env(name: str, required: bool = True) -> str | None:
    value = os.getenv(name, "").strip()
    if required and not value:
        raise ValueError(f"Required environment variable {name} is not configured")
    return value or None


def _next_au_business_day(today: date | None = None) -> date:
    current = today or datetime.now(ZoneInfo("Australia/Sydney")).date()
    current += timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current


def build_tracking_xml(number: str) -> str:
    number = number.strip()
    if not number:
        raise ValueError("Tracking number is required")
    root = ET.Element("TrackRequest")
    criteria = ET.SubElement(root, "SearchCriteria")
    ET.SubElement(criteria, "ConsignmentNumber").text = number
    detail = ET.SubElement(root, "LevelOfDetail")
    ET.SubElement(detail, "Complete")
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + ET.tostring(root, encoding="unicode")


def build_rtt_xml(shipping_date: date | None = None) -> str:
    root = ET.Element("enquiry", xmlns="http://www.tntexpress.com.au")
    rated = ET.SubElement(root, "ratedTransitTimeEnquiry")
    cutoff = ET.SubElement(rated, "cutOffTimeEnquiry")
    for tag, values in (
        ("collectionAddress", ("Ryde", "NSW", "2112")),
        ("deliveryAddress", ("Fitzroy", "VIC", "3065")),
    ):
        address = ET.SubElement(cutoff, tag)
        for field, value in zip(("suburb", "state", "postCode"), values):
            ET.SubElement(address, field).text = value
    ship_date = shipping_date or _next_au_business_day()
    ET.SubElement(cutoff, "shippingDate").text = ship_date.isoformat()
    ET.SubElement(cutoff, "userCurrentLocalDateTime").text = datetime.now(ZoneInfo("Australia/Sydney")).replace(tzinfo=None).isoformat(timespec="seconds")
    dangerous = ET.SubElement(cutoff, "dangerousGoods")
    ET.SubElement(dangerous, "dangerous").text = "false"
    packages = ET.SubElement(cutoff, "packageLines", packageType="D")
    line = ET.SubElement(packages, "packageLine")
    ET.SubElement(line, "numberOfPackages").text = "1"
    dims = ET.SubElement(line, "dimensions", unit="cm")
    for field in ("length", "width", "height"):
        ET.SubElement(dims, field).text = "20"
    weight = ET.SubElement(line, "weight", unit="kg")
    ET.SubElement(weight, "weight").text = "1"
    payment = ET.SubElement(rated, "termsOfPayment")
    ET.SubElement(payment, "senderAccount").text = _env("TNT_RTT_ACCOUNT_NUMBER")
    ET.SubElement(payment, "payer").text = "S"
    return ET.tostring(root, encoding="unicode", xml_declaration=True)


def build_pricing_xml(collection_date: datetime | None = None) -> str:
    root = ET.Element("priceRequest")
    ET.SubElement(root, "appId").text = "PC"
    ET.SubElement(root, "appVersion").text = "3.2"
    check = ET.SubElement(root, "priceCheck")
    ET.SubElement(check, "rateId").text = "1"
    for tag, town, state, postcode in (("sender", "Ryde", "NSW", "2112"), ("delivery", "Fitzroy", "VIC", "3065")):
        address = ET.SubElement(check, tag)
        ET.SubElement(address, "country").text = "AU"
        ET.SubElement(address, "town").text = town
        ET.SubElement(address, "postcode").text = postcode
    # The API expects a future collection date. No Domestic UAT account is
    # supplied here: its ExpressConnect entitlement has not been established.
    future = collection_date or datetime.combine(_next_au_business_day(), time(9, 0), ZoneInfo("Australia/Sydney"))
    ET.SubElement(check, "collectionDateTime").text = future.isoformat(timespec="seconds")
    product = ET.SubElement(check, "product")
    ET.SubElement(product, "type").text = "N"
    ET.SubElement(check, "termsOfPayment").text = "S"
    ET.SubElement(check, "currency").text = "AUD"
    ET.SubElement(check, "priceBreakDown").text = "true"
    details = ET.SubElement(check, "consignmentDetails")
    ET.SubElement(details, "totalWeight").text = "1.0"
    ET.SubElement(details, "totalVolume").text = "0.008"
    ET.SubElement(details, "totalNumberOfPieces").text = "1"
    piece = ET.SubElement(check, "pieceLine")
    ET.SubElement(piece, "numberOfPieces").text = "1"
    measurements = ET.SubElement(piece, "pieceMeasurements")
    for field, value in (("length", "0.2"), ("width", "0.2"), ("height", "0.2"), ("weight", "1.0")):
        ET.SubElement(measurements, field).text = value
    ET.SubElement(piece, "pallet").text = "false"
    return ET.tostring(root, encoding="unicode", xml_declaration=True)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1]


def _text(node: Any, *names: str) -> str | None:
    wanted = {name.lower() for name in names}
    for child in node.iter():
        if _local(child.tag).lower() in wanted and child.text and child.text.strip():
            return child.text.strip()
    return None


def _xml_error_text(root: Any) -> str:
    chunks = []
    for node in root.iter():
        if _local(node.tag).lower() in {"error", "errormessage", "errorreason", "faultstring", "message", "description"} and node.text:
            value = " ".join(node.text.split())
            if value and value not in chunks:
                chunks.append(value)
    return "; ".join(chunks[:4])[:600]


def _iso_key(value: str) -> tuple[float, str]:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (parsed.timestamp(), value)
    except (ValueError, OverflowError):
        return (float("-inf"), value)


def parse_tracking_xml(xml: str) -> dict[str, Any]:
    root = SafeET.fromstring(xml)
    consignment = next((node for node in root.iter() if _local(node.tag).lower() == "consignment"), None)
    if consignment is None:
        error = _xml_error_text(root)
        if error:
            return {"business_error": error}
        return {"empty": True}
    number = _text(consignment, "ConsignmentNumber")
    summary = _text(consignment, "SummaryCode")
    status_map = {"INT": "IN_TRANSIT", "DEL": "DELIVERED", "EXC": "EXCEPTION", "CNF": "NOT_FOUND"}
    events: list[dict[str, str | None]] = []
    for node in consignment.iter():
        if _local(node.tag).lower() != "statusdata":
            continue
        event_date = _text(node, "StatusDateTime", "DateTime")
        if not event_date:
            day = _text(node, "StatusDate", "Date")
            clock = _text(node, "StatusTime", "Time")
            event_date = f"{day}T{clock}" if day and clock else day
        events.append({
            "status": _text(node, "StatusDescription", "Description", "Status"),
            "code": _text(node, "StatusCode"),
            "date": event_date,
            "location": _text(node, "Depot", "Location", "DepotName"),
        })
    events.sort(key=lambda event: _iso_key(event["date"] or ""), reverse=True)
    return {"consignment_number": number, "summary_code": summary,
            "status": status_map.get(summary or "", "UNKNOWN"), "events": events}


def parse_rates_xml(xml: str) -> list[dict[str, str | None]]:
    root = SafeET.fromstring(xml)
    rates: list[dict[str, str | None]] = []
    for node in root.iter():
        if _local(node.tag).lower() != "ratedservice":
            continue
        product = next((child for child in node if _local(child.tag).lower() == "product"), None)
        product_id = _text(product, "id", "productId", "productCode") if product is not None else None
        service_name = _text(product, "productDesc", "productDescription", "productName", "serviceName") if product is not None else None
        amount = _text(node, "totalPrice", "price", "totalCost", "amount", "netPrice")
        if not product_id and not service_name and not amount:
            continue
        try:
            if amount is not None:
                Decimal(amount)
        except InvalidOperation:
            continue
        rates.append({"service": product_id, "service_name": service_name, "amount": amount,
                      "amount_ex_vat": _text(node, "totalPriceExclVat"), "vat": _text(node, "vatAmount"),
                      "currency": _text(root, "currency")})
    return rates


def parse_rtt_xml(xml: str) -> list[dict[str, str | None]]:
    root = SafeET.fromstring(xml)
    candidates: list[dict[str, str | None]] = []
    possible_services = {"ratedservice", "service", "serviceoption", "operationalservice", "servicelevel"}
    for node in root.iter():
        if _local(node.tag).lower() not in possible_services:
            continue
        code = _text(node, "serviceCode", "serviceId", "code", "serviceType")
        name = _text(node, "serviceName", "serviceDescription", "description", "name")
        price = _text(node, "price", "totalPrice", "freightCharge", "rate", "amount", "charge")
        if not code and not name:
            continue
        try:
            if price is not None:
                Decimal(price)
        except InvalidOperation:
            continue
        candidates.append({"service": code, "service_name": name, "amount": price, "currency": "AUD"})
    return [candidate for candidate in candidates if candidate["amount"] is not None]


def _classify_error(message: str) -> str:
    text = message.lower()
    if any(token in text for token in ("unauthor", "invalid credential", "invalid login", "authentication", "login failed")):
        return "AUTH_FAILED"
    if any(token in text for token in ("permission", "not permitted", "not authorised", "not authorized", "account not registered", "account is not registered", "access denied")):
        return "PERMISSION_DENIED"
    if any(token in text for token in ("not supported in australia", "australia domestic", "domestic consignments are not supported", "not supported for au")):
        return "UNSUPPORTED_MARKET"
    if any(token in text for token in ("not found", "no consignment", "invalid consignment")):
        return "NOT_FOUND"
    return "XML_ERROR"


def _safe_summary(message: str, secrets: list[str]) -> str:
    value = " ".join(message.split())
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[redacted]")
    value = re.sub(r"(?i)(password|authorization|account(number)?|username)\s*[:=]\s*\S+", r"\1=[redacted]", value)
    return value[:400]


def _base_result(case_id: str, endpoint: str) -> SmokeResult:
    return SmokeResult(case_id=case_id, endpoint=endpoint)


def _execute(case_id: str, endpoint: str, xml: str, *, auth: tuple[str, str] | None,
             data: dict[str, str], secrets: list[str], dry_run: bool = False) -> SmokeResult:
    result = _base_result(case_id, endpoint)
    if dry_run:
        result.api_business_result = "DRY_RUN"
        result.failure_category = "NOT_TESTED"
        fields = set(data)
        fields.add("xml_in" if "xml_in" in data else "XMLRequest")
        result.parsed = {"method": "POST", "content_type": "application/x-www-form-urlencoded", "fields": sorted(fields), "xml_bytes": len(xml.encode())}
        return result
    try:
        with httpx.Client(auth=auth, timeout=TIMEOUT, verify=True, follow_redirects=False, trust_env=True) as client:
            response = client.post(endpoint, data={**data, "xml_in": xml} if "xml_in" in data else {**data, "XMLRequest": xml})
        result.http_status = response.status_code
        result.response_content_type = response.headers.get("content-type", "").split(";")[0] or None
        if response.status_code == 401:
            result.authentication_result, result.failure_category = "REJECTED", "AUTH_FAILED"
            result.api_business_result = "HTTP_REJECTED"
            result.safe_error_summary = "TNT rejected the supplied credentials (HTTP 401)."
            return result
        if response.status_code == 403:
            result.authentication_result, result.failure_category = "ACCEPTED_OR_IDENTIFIED", "PERMISSION_DENIED"
            result.api_business_result = "HTTP_REJECTED"
            result.safe_error_summary = "TNT denied access to this API/account (HTTP 403)."
            return result
        if response.status_code in (404, 410) and case_id == "RTT":
            result.failure_category = "ENDPOINT_UNAVAILABLE"
            result.api_business_result = "ENDPOINT_REJECTED"
            result.safe_error_summary = f"Legacy RTT endpoint returned HTTP {response.status_code}."
            return result
        if response.status_code >= 500 or response.status_code == 429:
            result.failure_category = "ENDPOINT_UNAVAILABLE"
            result.api_business_result = "HTTP_REJECTED"
            result.safe_error_summary = f"TNT service returned HTTP {response.status_code}."
            return result
        if response.status_code >= 400:
            result.failure_category = "XML_ERROR"
            result.api_business_result = "HTTP_REJECTED"
            result.safe_error_summary = f"TNT rejected the request with HTTP {response.status_code}."
            return result
        try:
            root = SafeET.fromstring(response.content)
        except Exception as exc:
            is_html = "html" in (result.response_content_type or "").lower()
            result.failure_category = "ENDPOINT_UNAVAILABLE" if case_id == "RTT" and is_html else "XML_ERROR"
            result.api_business_result = "NON_XML_RESPONSE" if is_html else "INVALID_XML"
            result.safe_error_summary = f"Response body was not parseable XML ({type(exc).__name__})."
            return result
        if case_id == "TRACKING":
            parsed = parse_tracking_xml(response.text)
            if parsed.get("business_error"):
                summary = parsed.pop("business_error")
                result.safe_error_summary = _safe_summary(summary, secrets)
                result.failure_category = _classify_error(summary)
                result.authentication_result = "ACCEPTED_OR_IDENTIFIED" if result.failure_category == "PERMISSION_DENIED" else "UNKNOWN"
                result.api_business_result = "BUSINESS_ERROR"
            elif parsed.get("empty"):
                result.failure_category, result.api_business_result = "EMPTY_RESULT", "NO_CONSIGNMENT_NODE"
                result.safe_error_summary = "Valid XML response contained no Consignment result."
            elif parsed.get("status") == "NOT_FOUND":
                result.failure_category, result.api_business_result = "NOT_FOUND", "NO_MATCH"
                result.authentication_result = "ACCEPTED"
            else:
                result.failure_category = "VERIFIED_SUCCESS"
                result.api_business_result = "TRACKING_DATA_RETURNED"
                result.authentication_result = "ACCEPTED"
            result.parsed = parsed
        elif case_id == "PRICING":
            errors = _xml_error_text(root)
            rates = parse_rates_xml(response.text)
            if rates:
                result.failure_category, result.api_business_result = "VERIFIED_SUCCESS", "RATES_RETURNED"
                result.authentication_result = "ACCEPTED"
                result.parsed = rates
            elif errors:
                result.safe_error_summary = _safe_summary(errors, secrets)
                result.failure_category = _classify_error(errors)
                result.authentication_result = "UNKNOWN"
                result.api_business_result = "BUSINESS_ERROR"
                result.parsed = {"response_root": _local(root.tag)}
            else:
                result.failure_category, result.api_business_result = "EMPTY_RESULT", "NO_RATE_CANDIDATES"
                result.parsed = {"response_root": _local(root.tag)}
                result.safe_error_summary = "Valid XML response contained no recognizable price/service candidates."
        else:
            errors = _xml_error_text(root)
            rates = parse_rtt_xml(response.text)
            if rates:
                result.failure_category, result.api_business_result = "VERIFIED_SUCCESS", "RATES_RETURNED"
                result.authentication_result = "ACCEPTED"
                result.parsed = rates
            elif errors:
                result.safe_error_summary = _safe_summary(errors, secrets)
                result.failure_category = _classify_error(errors)
                result.authentication_result = "UNKNOWN"
                result.api_business_result = "BUSINESS_ERROR"
                result.parsed = {"response_root": _local(root.tag)}
            else:
                result.failure_category, result.api_business_result = "EMPTY_RESULT", "NO_RATE_CANDIDATES"
                result.parsed = {"response_root": _local(root.tag)}
                result.safe_error_summary = "Valid XML response contained no recognizable service/rate candidates."
        return result
    except httpx.TimeoutException as exc:
        result.failure_category = "TIMEOUT"
        result.api_business_result = "NO_RESPONSE"
        result.safe_error_summary = f"Request timed out ({type(exc).__name__})."
        return result
    except (httpx.ConnectError, httpx.NetworkError, httpx.ProtocolError) as exc:
        message = str(exc).lower()
        result.failure_category = "TLS_ERROR" if "certificate verify failed" in message or "cert_verify" in message else "NETWORK_ERROR"
        result.api_business_result = "NO_RESPONSE"
        label = "TLS certificate validation failed" if result.failure_category == "TLS_ERROR" else type(exc).__name__
        result.safe_error_summary = label
        return result
    except httpx.HTTPError as exc:
        result.failure_category = "NETWORK_ERROR"
        result.api_business_result = "NO_RESPONSE"
        result.safe_error_summary = type(exc).__name__
        return result


def run_rtt(dry_run: bool = False) -> SmokeResult:
    username, password, account = (_env("TNT_RTT_USERNAME"), _env("TNT_RTT_PASSWORD"), _env("TNT_RTT_ACCOUNT_NUMBER"))
    xml = build_rtt_xml()
    return _execute("RTT", RTT_URL, xml, auth=None, data={"Username": username, "Password": password, "Version": "2"}, secrets=[username, password, account or ""], dry_run=dry_run)


def run_tracking(number: str, dry_run: bool = False) -> SmokeResult:
    username, password = (_env("TNT_EXPRESSCONNECT_USERNAME"), _env("TNT_EXPRESSCONNECT_PASSWORD"))
    xml = build_tracking_xml(number)
    return _execute("TRACKING", TRACK_URL, xml, auth=(username, password), data={"xml_in": ""}, secrets=[username, password], dry_run=dry_run)


def run_pricing(dry_run: bool = False) -> SmokeResult:
    username, password = (_env("TNT_EXPRESSCONNECT_USERNAME"), _env("TNT_EXPRESSCONNECT_PASSWORD"))
    xml = build_pricing_xml()
    return _execute("PRICING", PRICING_URL, xml, auth=(username, password), data={"xml_in": ""}, secrets=[username, password], dry_run=dry_run)


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=("rtt", "tracking", "expressconnect-pricing"))
    parser.add_argument("--number", default="305506914", help="Consignment number for tracking")
    parser.add_argument("--dry-run", action="store_true", help="Show only a sanitized request summary")
    args = parser.parse_args()
    try:
        result = {"rtt": run_rtt, "tracking": lambda dry_run=False: run_tracking(args.number, dry_run),
                  "expressconnect-pricing": run_pricing}[args.case](args.dry_run)
    except ValueError as exc:
        print(json.dumps({"case_id": args.case.upper(), "failure_category": "NOT_TESTED", "safe_error_summary": str(exc)}, indent=2))
        return 2
    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))
    return 0 if args.dry_run or result.failure_category == "VERIFIED_SUCCESS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
