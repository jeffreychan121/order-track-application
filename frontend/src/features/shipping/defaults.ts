/** 生成项目指定的澳洲默认发货地；每次返回新对象供表单独立编辑。 */
export const defaultShippingOrigin = () => ({ type: 'MERCHANT_LOCATION', lines: [] as string[], suburb: 'RYDE', postcode: '2112', state: 'NSW', country: 'AU' });
/** 生成示例目的地，实际订单报价会优先采用客户地址。 */
export const defaultShippingDestination = () => ({ type: 'STANDARD_ADDRESS', lines: [] as string[], suburb: 'Sydney', postcode: '2000', state: 'NSW', country: 'AU' });

/** 将订单收货地址转换为承运商报价格式；仅缺少地址对象时才回退到示例地址。 */
export const orderShippingDestination = (address?: Record<string, unknown> | null, addressLine2?: string | null) => {
  if (!address) return defaultShippingDestination();

  const countryName = String(address.country ?? '').trim();
  const country = /^(australia|au)$/i.test(countryName)
    ? 'AU'
    : /^[a-z]{2}$/i.test(countryName) ? countryName.toUpperCase() : '';
  const street = String(address.street ?? '').trim();
  const secondLine = String(addressLine2 ?? address.address_line2 ?? '').trim();

  return {
    type: 'STANDARD_ADDRESS',
    lines: [street, secondLine].filter(Boolean),
    suburb: String(address.suburb ?? '').trim(),
    postcode: String(address.postcode ?? '').trim(),
    state: String(address.state ?? '').trim().toUpperCase(),
    country,
  };
};
