#!/usr/bin/env python3

import os
from pathlib import Path


def main():
    Path(__file__).with_name('debuggee.pid').write_text(str(os.getpid()), encoding='ascii')
    engine = build_engine()
    values = [int(x) for x in engine['items'] if x.isdigit()]
    total = sum(values)
    report = {'total': total, 'count': len(engine['items'])}
    print(report)


def build_engine():
    items = [
        '1', '2', 'Fizz', '4', 'Buzz',
        'Fizz', '7', '8', 'Fizz', 'Buzz',
        '11', '10'
    ]
    return {'items': items}


if __name__ == '__main__':
    main()
