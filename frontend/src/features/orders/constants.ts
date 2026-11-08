export const statusLabels: Record<string, string> = { draft: 'Draft', confirmed: 'Confirmed', in_transit: 'In Transit', completed: 'Completed' };
export const statusSequence = ['draft', 'confirmed', 'in_transit', 'completed'];
/** 新建订单地址的演示默认值；实际下单前用户可编辑客户收货地址。 */
export const defaultOrderShippingAddress = () => ({ street: '', address_line2: '', suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'Australia' });
