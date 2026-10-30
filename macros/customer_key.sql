{% macro customer_key(expression) -%}
    {% set salt = env_var('CUSTOMER_KEY_SALT', '') %}
    {% if salt | length < 32 %}
        {{ exceptions.raise_compiler_error('CUSTOMER_KEY_SALT must contain at least 32 characters. Keep it stable and protect compiled artifacts.') }}
    {% endif %}
    SHA2(CONCAT('{{ salt | replace("'", "''") }}', ':', TO_VARCHAR({{ expression }})), 256)
{%- endmacro %}
