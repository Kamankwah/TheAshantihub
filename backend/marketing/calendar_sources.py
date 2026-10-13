"""What the campaign calendar reads from each package. Each source returns plain dicts."""
from .banners import banner_entries  # noqa: F401  (banner windows: [{id, kind:'banner', title, starts_at, ends_at, status}])
from .flash_sales import flash_sale_entries  # noqa: F401  (flash-sale windows: [{id, kind:'flash_sale', title, starts_at, ends_at, status}])
