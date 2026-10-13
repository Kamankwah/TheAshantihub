"""Where we deliver. v1 uses ASHANTI_RING, an approximate bounding rectangle, NOT the region's boundary: it covers
about 1.9 times Ashanti's area and is known to admit parts of neighbouring regions (for example Sunyani, Goaso,
Sefwi Wiawso, Berekum, Bibiani, Nkawkaw, Akim Oda and Kade). Replace it with the OpenStreetMap administrative
boundary plus a small buffer before delivery coverage is relied on (spec open item). Ring points are [lng, lat],
the format delivery.services.point_in_ring reads."""
from delivery import services

ASHANTI_RING = [[-2.80, 5.80], [-0.60, 5.80], [-0.60, 7.50], [-2.80, 7.50]]
OUT_OF_AREA_MESSAGE = "We only deliver within the Ashanti Region for now."


def in_service_area(lat, lng):
    point = services.valid_point(lat, lng)
    if point is None:
        return False
    return services.point_in_ring(point[0], point[1], ASHANTI_RING)
