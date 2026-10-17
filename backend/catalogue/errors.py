"""The one refusal shape of the catalogue API: {"detail", "code"} (plus optional `extra` fields) with an HTTP status."""


class CatalogueError(Exception):
    def __init__(self, message, code, status_code=400, extra=None):
        super().__init__(message)
        self.message, self.code, self.status_code, self.extra = message, code, status_code, extra or {}

    def body(self):
        return {"detail": self.message, "code": self.code, **self.extra}
