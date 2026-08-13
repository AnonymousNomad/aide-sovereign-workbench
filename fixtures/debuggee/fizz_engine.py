import os


def build_items(limit):
    items = []
    for i in range(1, limit + 1):
        if i % 15 == 0:
            items.append("FizzBuzz")
        elif i % 3 == 0:
            items.append("Fizz")
        elif i % 5 == 0:
            items.append("Buzz")
        else:
            items.append(str(i))
    return items


def main():
    engine = {
        "name": "fizz-engine",
        "items": build_items(15),
        "nested": {"meta": {"depth": 3, "active": True}},
    }
    total = sum(map(len, map(str, engine["items"])))
    report = {"ok": True, "total": total, "engine": engine}
    with open(os.path.join(os.path.dirname(__file__), "debuggee.pid"), "w") as fh:
        fh.write(str(os.getpid()))
    print(report)


main()
