from rest_framework import serializers

from .models import CreditScore, LendingPartner, LoanApplication
from .scoring import LOAN_ELIGIBLE_THRESHOLD, grade_for_score


class CreditScoreSerializer(serializers.ModelSerializer):
    # `score` is the number that counts (effective = base + staff adjustment),
    # so the business/staff frontends that already read `score` keep working
    # unchanged and automatically pick up any adjustment. base_score and
    # manual_adjustment are exposed alongside so a staffer can see the split.
    score = serializers.SerializerMethodField()
    base_score = serializers.IntegerField(source="score", read_only=True)
    grade = serializers.SerializerMethodField()
    grade_label = serializers.SerializerMethodField()
    loan_eligible = serializers.SerializerMethodField()

    class Meta:
        model = CreditScore
        fields = [
            "score", "base_score", "manual_adjustment", "adjustment_reason",
            "grade", "grade_label", "loan_eligible", "factors", "computed_at",
        ]

    def get_score(self, obj):
        return obj.effective_score

    def get_grade(self, obj):
        return grade_for_score(obj.effective_score)[0]

    def get_grade_label(self, obj):
        return grade_for_score(obj.effective_score)[1]

    def get_loan_eligible(self, obj):
        return obj.effective_score >= LOAN_ELIGIBLE_THRESHOLD


class CreditScoreStaffListSerializer(CreditScoreSerializer):
    business_owner = serializers.IntegerField(source="business_owner.id")
    business_owner_name = serializers.CharField(source="business_owner.full_name")
    adjusted_by_name = serializers.CharField(
        source="adjusted_by.full_name", read_only=True, default=None
    )

    class Meta(CreditScoreSerializer.Meta):
        fields = [
            "business_owner", "business_owner_name", "adjusted_by_name", "adjusted_at",
            *CreditScoreSerializer.Meta.fields,
        ]


class LendingPartnerSerializer(serializers.ModelSerializer):
    class Meta:
        model = LendingPartner
        fields = [
            "id", "name", "partner_type", "logo", "color", "min_score",
            "max_loan", "interest_rate", "turnaround", "focus", "contact",
            "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class LoanApplicationSerializer(serializers.ModelSerializer):
    """Read shape for staff (the loan queue) and the business owner's own
    application list.
    """

    business_owner_name = serializers.CharField(
        source="business_owner.full_name", read_only=True
    )
    lending_partner_name = serializers.CharField(
        source="lending_partner.name", read_only=True, default=None
    )
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = LoanApplication
        fields = [
            "id", "business_owner", "business_owner_name",
            "lending_partner", "lending_partner_name",
            "amount", "purpose", "score_at_application", "status",
            "decision_notes", "reviewed_by_name", "reviewed_at", "created_at",
        ]
        read_only_fields = fields


class LoanApplicationCreateSerializer(serializers.ModelSerializer):
    """Input shape for a business owner submitting an application. Only the
    borrower-supplied fields — business_owner, score_at_application, and status
    are all set by the view, never trusted from the body.
    """

    class Meta:
        model = LoanApplication
        fields = ["lending_partner", "amount", "purpose"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Loan amount must be greater than zero.")
        return value
