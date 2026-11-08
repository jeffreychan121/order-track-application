from datetime import date, datetime
from pathlib import Path
import sys

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts import tnt_smoke  # noqa: E402


def test_tracking_xml_has_complete_level_and_dynamic_number():
    xml = tnt_smoke.build_tracking_xml("  305506914  ")
    root = tnt_smoke.SafeET.fromstring(xml)
    assert root.findtext("./SearchCriteria/ConsignmentNumber") == "305506914"
    assert root.find("./LevelOfDetail/Complete") is not None


def test_rtt_xml_has_legacy_domestic_request_structure(monkeypatch):
    monkeypatch.setenv("TNT_RTT_ACCOUNT_NUMBER", "30000000")
    xml = tnt_smoke.build_rtt_xml(date(2026, 11, 9))
    root = tnt_smoke.SafeET.fromstring(xml)
    ns = {"t": "http://www.tntexpress.com.au"}
    enquiry = root.find("t:ratedTransitTimeEnquiry", ns)
    assert enquiry.findtext("t:cutOffTimeEnquiry/t:collectionAddress/t:postCode", namespaces=ns) == "2112"
    assert enquiry.findtext("t:cutOffTimeEnquiry/t:deliveryAddress/t:postCode", namespaces=ns) == "3065"
    assert enquiry.findtext("t:cutOffTimeEnquiry/t:shippingDate", namespaces=ns) == "2026-11-09"
    packages = enquiry.find("t:cutOffTimeEnquiry/t:packageLines", ns)
    assert packages.attrib["packageType"] == "D"
    dims = packages.find("t:packageLine/t:dimensions", ns)
    assert dims.attrib["unit"] == "cm"
    assert dims.findtext("t:length", namespaces=ns) == "20"
    weight = packages.find("t:packageLine/t:weight", ns)
    assert weight.attrib["unit"] == "kg"
    assert weight.findtext("t:weight", namespaces=ns) == "1"
    assert enquiry.findtext("t:termsOfPayment/t:senderAccount", namespaces=ns) == "30000000"


def test_pricing_xml_uses_meters_and_omits_unconfirmed_account():
    xml = tnt_smoke.build_pricing_xml(datetime.fromisoformat("2026-11-09T09:00:00+11:00"))
    root = tnt_smoke.SafeET.fromstring(xml)
    check = root.find("priceCheck")
    assert root.findtext("appId") == "PC"
    assert root.findtext("appVersion") == "3.2"
    assert check.findtext("sender/town") == "Ryde"
    assert check.findtext("delivery/postcode") == "3065"
    assert check.findtext("product/type") == "N"
    assert check.findtext("currency") == "AUD"
    assert check.findtext("consignmentDetails/totalVolume") == "0.008"
    assert check.findtext("pieceLine/pieceMeasurements/length") == "0.2"
    assert check.findtext("pieceLine/pieceMeasurements/weight") == "1.0"
    assert check.find("account") is None
    assert check.findtext("priceBreakDown") == "true"


def test_namespaced_tracking_response_maps_code_and_sorts_full_events():
    xml = """<TrackResponse xmlns='urn:test'><Consignment><ConsignmentNumber>305506914</ConsignmentNumber><SummaryCode>INT</SummaryCode>
      <StatusData><StatusCode>OLD</StatusCode><StatusDescription>Picked up</StatusDescription><StatusDate>2026-11-05</StatusDate><StatusTime>10:00:00+11:00</StatusTime><Depot>Ryde</Depot></StatusData>
      <StatusData><StatusCode>NEW</StatusCode><StatusDescription>In transit</StatusDescription><StatusDateTime>2026-11-06T09:00:00+11:00</StatusDateTime><Depot>Sydney</Depot></StatusData>
    </Consignment></TrackResponse>"""
    result = tnt_smoke.parse_tracking_xml(xml)
    assert result["status"] == "IN_TRANSIT"
    assert result["consignment_number"] == "305506914"
    assert result["events"][0]["date"] == "2026-11-06T09:00:00+11:00"
    assert result["events"][1]["date"] == "2026-11-05T10:00:00+11:00"


@pytest.mark.parametrize(("code", "expected"), [
    ("INT", "IN_TRANSIT"), ("DEL", "DELIVERED"), ("EXC", "EXCEPTION"), ("CNF", "NOT_FOUND")
])
def test_tracking_status_mapping(code, expected):
    result = tnt_smoke.parse_tracking_xml(f"<TrackResponse><Consignment><SummaryCode>{code}</SummaryCode></Consignment></TrackResponse>")
    assert result["status"] == expected


def test_pricing_response_parses_multiple_services_and_currency():
    xml = """<document><priceResponse><ratedServices><rateId>r</rateId><currency>AUD</currency>
      <ratedService><product><id>R</id><productDesc>Road</productDesc></product><totalPrice>12.34</totalPrice><totalPriceExclVat>11.22</totalPriceExclVat><vatAmount>1.12</vatAmount></ratedService>
      <ratedService><product><id>E</id><productDesc>Express</productDesc></product><totalPrice>19.50</totalPrice><totalPriceExclVat>17.73</totalPriceExclVat><vatAmount>1.77</vatAmount></ratedService>
    </ratedServices></priceResponse></document>"""
    assert tnt_smoke.parse_rates_xml(xml) == [
        {"service": "R", "service_name": "Road", "amount": "12.34", "amount_ex_vat": "11.22", "vat": "1.12", "currency": "AUD"},
        {"service": "E", "service_name": "Express", "amount": "19.50", "amount_ex_vat": "17.73", "vat": "1.77", "currency": "AUD"},
    ]


def test_rtt_parser_only_accepts_service_with_numeric_price():
    assert tnt_smoke.parse_rtt_xml("<response><service><serviceCode>R</serviceCode><description>Road</description><price>10.50</price></service></response>") == [
        {"service": "R", "service_name": "Road", "amount": "10.50", "currency": "AUD"}
    ]
    assert tnt_smoke.parse_rtt_xml("<response><error>Denied</error></response>") == []


@pytest.mark.parametrize(("status", "expected"), [(401, "AUTH_FAILED"), (403, "PERMISSION_DENIED"), (503, "ENDPOINT_UNAVAILABLE")])
def test_http_status_failure_classification(monkeypatch, status, expected):
    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["verify"] is True
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, endpoint, data):
            return httpx.Response(status, request=httpx.Request("POST", endpoint), headers={"content-type": "text/xml"})

    monkeypatch.setattr(tnt_smoke.httpx, "Client", FakeClient)
    result = tnt_smoke._execute("TRACKING", tnt_smoke.TRACK_URL, "<xml/>", auth=("u", "p"),
        data={"xml_in": ""}, secrets=["u", "p"])
    assert result.failure_category == expected


def test_timeout_tls_and_no_credentials_do_not_leak_secrets(monkeypatch, capsys):
    class FakeClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, *args, **kwargs):
            request = httpx.Request("POST", tnt_smoke.TRACK_URL)
            raise httpx.ConnectError("certificate verify failed", request=request)
    monkeypatch.setattr(tnt_smoke.httpx, "Client", FakeClient)
    result = tnt_smoke._execute("TRACKING", tnt_smoke.TRACK_URL, "<xml/>", auth=("secret-user", "secret-pass"),
        data={"xml_in": ""}, secrets=["secret-user", "secret-pass"])
    assert result.failure_category == "TLS_ERROR"
    assert "secret" not in str(result).lower()
    assert "secret" not in capsys.readouterr().out.lower()


def test_read_timeout_is_distinct_from_network_failure(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, *args, **kwargs):
            request = httpx.Request("POST", tnt_smoke.TRACK_URL)
            raise httpx.ReadTimeout("simulated timeout", request=request)
    monkeypatch.setattr(tnt_smoke.httpx, "Client", FakeClient)
    result = tnt_smoke._execute("TRACKING", tnt_smoke.TRACK_URL, "<xml/>", auth=("u", "p"),
        data={"xml_in": ""}, secrets=["u", "p"])
    assert result.failure_category == "TIMEOUT"


def test_next_au_business_day_skips_weekend():
    assert tnt_smoke._next_au_business_day(date(2026, 11, 6)) == date(2026, 11, 9)
