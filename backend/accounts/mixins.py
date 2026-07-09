class AuthenticatableAccountMixin:
    """Duck-types Django's auth.User enough to satisfy DRF's IsAuthenticated checks."""

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False


class AnonymousUser:
    """Represents an unauthenticated user, duck-typing Django's contrib.auth.models.AnonymousUser."""

    @property
    def is_authenticated(self):
        return False

    @property
    def is_anonymous(self):
        return True
