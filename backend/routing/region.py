"""Where we deliver: the whole Ashanti Region. v1 uses an approximate bounding polygon (it also admits a thin strip
of neighbouring districts); replace ASHANTI_RING with the OpenStreetMap administrative boundary when available
(spec open item). Ring points are [lng, lat], the format delivery.services.point_in_ring reads."""
from delivery import services

ASHANTI_RING = [[-2.80, 5.80], [-0.60, 5.80], [-0.60, 7.50], [-2.80, 7.50]]
OUT_OF_AREA_MESSAGE = "We only deliver within the Ashanti Region for now."


def in_service_area(lat, lng):
    point = services.valid_point(lat, lng)
    if point is None:
        return False
    return services.point_in_ring(point[0], point[1], ASHANTI_RING)
