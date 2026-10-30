SELECT o.transaction_id
FROM {{ ref('orders') }} AS o
JOIN {{ ref('customer') }} AS c ON o.customer_id = c.customer_id
JOIN {{ ref('product') }} AS p ON o.product_id = p.product_id
WHERE o.transaction_date < c.created_at::DATE
    OR o.transaction_date < p.available_from
