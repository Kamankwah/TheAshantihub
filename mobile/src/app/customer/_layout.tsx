import { CUSTOMER_TABS } from "../../lib/routing";
import { RoleTabs } from "../../ui/RoleTabs";

export default function CustomerLayout() {
  return <RoleTabs area="customer" tabs={CUSTOMER_TABS} />;
}
