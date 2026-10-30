{% macro calculate_revenue(column_name) %}

ROUND(SUM({{ column_name }}),2)

{% endmacro %}