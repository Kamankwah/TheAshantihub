from django.db import models


class Category(models.Model):
    slug = models.SlugField(max_length=50, unique=True)
    icon = models.CharField(max_length=10)
    label = models.CharField(max_length=100)
    color = models.CharField(max_length=20)

    def __str__(self):
        return self.label


class Zone(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name
