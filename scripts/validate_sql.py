"""Offline Snowflake SQL grammar validation; never connects to a warehouse."""
from pathlib import Path
from types import SimpleNamespace
import re
import jinja2
import sqlglot

ROOT = Path(__file__).resolve().parents[1]
variables = {
    "feature_as_of_date": "2026-10-29",
    "source_loaded_at_field": "loaded_at",
    "customer_created_at_field": "created_at",
    "product_available_from_field": "available_from",
    "incremental_lookback_days": 7,
}
def fail(message):
    raise ValueError(message)
env = jinja2.Environment(undefined=jinja2.StrictUndefined, extensions=["jinja2.ext.do"])
env.globals.update(
    ref=lambda name: f'"VALIDATION"."{name.upper()}"',
    source=lambda schema, name: f'"{schema.upper()}"."{name.upper()}"',
    var=lambda name, default=None: variables.get(name, default),
    env_var=lambda name, default=None: "offline-validation-salt-with-at-least-32-characters" if name == "CUSTOMER_KEY_SALT" else default,
    config=lambda **kwargs: "",
    is_incremental=lambda: False,
    this='"VALIDATION"."INCREMENTAL_SALES"',
    adapter=SimpleNamespace(quote=lambda name: f'"{name}"'),
    modules=SimpleNamespace(re=re),
    exceptions=SimpleNamespace(raise_compiler_error=fail),
)
for name in ["calculate_revenue", "feature_as_of_date", "source_column", "customer_key"]:
    module = env.from_string((ROOT / "macros" / f"{name}.sql").read_text()).module
    env.globals[name] = getattr(module, name)
count = 0
for path in sorted((ROOT / "models").rglob("*.sql")) + sorted((ROOT / "tests").glob("*.sql")):
    source = path.read_text(encoding="utf-8-sig")
    for incremental in ([False, True] if path.stem == "incremental_sales" else [False]):
        env.globals["is_incremental"] = lambda value=incremental: value
        sql = env.from_string(source).render()
        try:
            parsed = sqlglot.parse(sql, read="snowflake", error_level=sqlglot.ErrorLevel.RAISE)
            if not parsed:
                raise ValueError("No SQL statement was rendered")
        except Exception as exc:
            raise RuntimeError(f"Invalid Snowflake SQL: {path.relative_to(ROOT)}") from exc
        count += 1
print(f"Validated {count} model/test SQL variants with the Snowflake grammar. Warehouse execution remains a separate acceptance check.")
