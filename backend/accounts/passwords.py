"""One rule for choosing a password (review BE-14, OWASP ASVS 2.1): at least 8 characters, not on Django's list of
20,000 commonly used passwords, and not all digits. Applied where a person *sets* a password (sign-up, reset, staff
activation); sign-in is never checked against it, so existing accounts are unaffected until they change theirs."""
from django.contrib.auth.password_validation import CommonPasswordValidator, NumericPasswordValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

_VALIDATORS = (CommonPasswordValidator(), NumericPasswordValidator())


def validate_new_password(value):
    """Raise a DRF ValidationError with plain sentences if ``value`` is a poor password; return it otherwise."""
    problems = []
    for validator in _VALIDATORS:
        try:
            validator.validate(value)
        except DjangoValidationError as exc:
            problems.extend(exc.messages)
    if problems:
        raise serializers.ValidationError(problems)
    return value
