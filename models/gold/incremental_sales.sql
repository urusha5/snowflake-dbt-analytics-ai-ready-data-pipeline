-- noqa: RF02

{{ config(
    materialized='incremental',
    unique_key='transaction_id',
    incremental_strategy='merge',
    on_schema_change='fail'
) }}

SELECT
    o.transaction_id,
    o.customer_id,
    o.product_id,
    o.quantity,
    o.total_amount,
    o.transaction_date,
    o.loaded_at,
    o.customer_key
FROM {{ ref('orders') }} AS o

{% if is_incremental() %}

    -- Reprocess same-day and late-arriving orders within a bounded lookback.
    -- Use --full-refresh or a longer lookback for older corrections.
    WHERE o.transaction_date >= (
        SELECT DATEADD(
            'day', -{{ var('incremental_lookback_days', 7) }},
            COALESCE(MAX(t.transaction_date), '1900-01-01'::DATE)
        )
        FROM {{ this }} AS t
    )

{% endif %}
