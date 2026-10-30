SELECT

    customer_id,

    INITCAP(customer_type) AS customer_type,

    LOWER(email) AS email,

    CASE
        WHEN age < 18 THEN NULL
        WHEN age > 120 THEN NULL
        ELSE age
    END AS age,

    INITCAP(gender) AS gender,

    TRY_TO_NUMBER(TO_VARCHAR(total_purchases)) AS total_purchases,

    created_at

FROM {{ ref('stg_customer') }}
