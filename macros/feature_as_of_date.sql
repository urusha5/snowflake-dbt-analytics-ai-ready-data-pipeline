{% macro feature_as_of_date() -%}
    {% if var('feature_as_of_date', '') %}
        TO_DATE('{{ var("feature_as_of_date") }}')
    {% else %}
        CURRENT_DATE()
    {% endif %}
{%- endmacro %}
