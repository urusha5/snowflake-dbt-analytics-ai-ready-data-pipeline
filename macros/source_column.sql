{% macro source_column(variable, fallback) -%}
    {% set column = var(variable, none) %}
    {% if column %}
        {% if not modules.re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', column) %}
            {{ exceptions.raise_compiler_error('Invalid ingestion column identifier: ' ~ variable) }}
        {% endif %}
        {{ adapter.quote(column | upper) }}
    {% else %}
        {{ fallback }}
    {% endif %}
{%- endmacro %}
