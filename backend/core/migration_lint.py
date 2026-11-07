"""Static checks for a Django migration file (review ARC-04).

Deploys run ``migrate`` while the previous release is still serving, and a rollback runs the previous code against the
new schema. So a migration must be safe for both: it may add, but must not remove or rewrite what the old code uses,
and must not hold a long table lock. This reads the file (it does not run it) and reports the operations that break
that rule. A reviewed exception is marked on the operation's line, or the line above, with
``# lint-migrations: ok <reason>``."""
import ast

ALLOW = "lint-migrations: ok"

BREAKING = {
    "RemoveField": "removes a column the previous release still reads; ship the code that stops using it first, drop it in a later release",
    "DeleteModel": "drops a table the previous release still uses; remove it in a later release",
    "RenameField": "renames a column the previous release still uses",
    "RenameModel": "renames a table the previous release still uses",
    "AlterField": "may rewrite the whole table or take a long lock (type, null or length change); check it on a copy of production data",
    "AlterModelTable": "renames a table the previous release still uses",
    "RunSQL": "raw SQL is not checked; confirm it is backward-compatible and does not lock a big table",
}


def _kwarg(call, name):
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _is_true(node):
    return isinstance(node, ast.Constant) and node.value is True


def lint_source(source):
    """Return a list of (line, operation, message) problems in this migration's source."""
    tree = ast.parse(source)
    lines = source.splitlines()
    problems = []

    def allowed(lineno):
        return any(ALLOW in lines[i] for i in (lineno - 1, lineno - 2) if 0 <= i < len(lines))

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        op = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
        if allowed(node.lineno):
            continue
        if op in BREAKING:
            problems.append((node.lineno, op, BREAKING[op]))
        elif op == "AddField":
            field = _kwarg(node, "field")
            if isinstance(field, ast.Call):
                null = _is_true(_kwarg(field, "null"))
                has_default = _kwarg(field, "default") is not None
                many = isinstance(field.func, ast.Attribute) and field.func.attr == "ManyToManyField"
                if not null and not has_default and not many:
                    problems.append((
                        node.lineno, op,
                        "adds a NOT NULL column with no default: the previous release's inserts fail. Give it a default or make it null=True",
                    ))
        elif op in ("AddIndex", "AddConstraint"):
            problems.append((
                node.lineno, op,
                "builds an index/constraint under a table lock; on a large table use AddIndexConcurrently (atomic = False) or mark it reviewed",
            ))
    return problems


if __name__ == "__main__":  # python backend/core/migration_lint.py <migration files...>  (CI: needs no Django or database)
    import sys

    found = 0
    for name in sys.argv[1:]:
        with open(name) as handle:
            for lineno, op, message in lint_source(handle.read()):
                found += 1
                print(f"{name}:{lineno}: {op} {message}", file=sys.stderr)
    print(f"{len(sys.argv) - 1} migration file(s) checked, {found} problem(s).")
    sys.exit(1 if found else 0)
