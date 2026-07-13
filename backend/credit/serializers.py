from rest_framework import serializers

from .models import CreditScore
from .scoring import LOAN_ELIGIBLE_THRESHOLD, grade_for_score


class CreditScoreSerializer(serializers.ModelSerializer):
    grade = serializers.SerializerMethodField()
    grade_label = serializers.SerializerMethodField()
    loan_eligible = serializers.SerializerMethodField()

    class Meta:
        model = CreditScore
        fields = ["score", "grade", "grade_label", "loan_eligible", "factors", "computed_at"]

    def get_grade(self, obj):
        return grade_for_score(obj.score)[0]

    def get_grade_label(self, obj):
        return grade_for_score(obj.score)[1]

    def get_loan_eligible(self, obj):
        return obj.score >= LOAN_ELIGIBLE_THRESHOLD


class CreditScoreStaffListSerializer(CreditScoreSerializer):
    business_owner = serializers.IntegerField(source="business_owner.id")
    business_owner_name = serializers.CharField(source="business_owner.full_name")

    class Meta(CreditScoreSerializer.Meta):
        fields = ["business_owner", "business_owner_name", *CreditScoreSerializer.Meta.fields]
