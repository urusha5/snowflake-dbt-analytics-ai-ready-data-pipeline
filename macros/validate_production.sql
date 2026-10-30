{% macro validate_production() %}
    {% if target.name == 'prod' %}
        {% set as_of = var('feature_as_of_date', '') %}
        {% if not modules.re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}', as_of) %}
            {{ exceptions.raise_compiler_error('Production requires an explicit feature_as_of_date in YYYY-MM-DD format.') }}
        {% endif %}
        {% if var('source_loaded_at_field', none) != 'loaded_at'
            or var('customer_created_at_field', none) != 'created_at'
            or var('product_available_from_field', none) != 'available_from' %}
            {{ exceptions.raise_compiler_error('Production requires loaded_at, customer created_at, and product available_from source columns.') }}
        {% endif %}
        {% if target.schema | upper == 'BRONZE' %}
            {{ exceptions.raise_compiler_error('Production output cannot use the bronze source schema.') }}
        {% endif %}
    {% endif %}
    {{ return('SELECT 1') }}
{% endmacro %}
