import { BUSINESS_TABS } from "../../lib/routing";
import { RoleTabs } from "../../ui/RoleTabs";

export default function BusinessLayout() {
  return <RoleTabs area="business" tabs={BUSINESS_TABS} />;
}
