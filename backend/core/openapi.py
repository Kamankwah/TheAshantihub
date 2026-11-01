from drf_spectacular.openapi import AutoSchema


class AshantiHubSchema(AutoSchema):
    """drf-spectacular reads `view.action` to find a method docstring. A few existing views set `action = None` for
    their own use, which makes that lookup raise; they get an empty description instead of breaking the whole schema."""

    def get_description(self):
        try:
            return super().get_description()
        except TypeError:
            return ""
