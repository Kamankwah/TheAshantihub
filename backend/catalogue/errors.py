"""The one refusal shape of the catalogue API: {"detail", "code"} with an HTTP status."""


class CatalogueError(Exception):
    def __init__(self, message, code, status_code=400):
        super().__init__(message)
        self.message, self.code, self.status_code = message, code, status_code

    def body(self):
        return {"detail": self.message, "code": self.code}
