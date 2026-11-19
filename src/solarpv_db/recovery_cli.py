"""Operator recovery: python -m solarpv_db.recovery_cli --help."""
import argparse
import json
import sys
from solarpv_db.recovery import create_package, verify_package, restore_package, RecoveryError


def main():
    parser = argparse.ArgumentParser(description='SOLARIS whole-instance recovery. Restores always use a NEW directory; active data is never replaced.')
    commands = parser.add_subparsers(dest='operation', required=True)
    create = commands.add_parser('create', help='Create and verify a database + private-file package')
    for name in ('database', 'storage', 'destination'):
        create.add_argument('--' + name, required=True)
    verify = commands.add_parser('verify', help='Check schema, database relationships and every file checksum')
    verify.add_argument('--package', required=True)
    restore = commands.add_parser('restore', help='Restore and verify into a new directory; does not switch the active application')
    for name in ('package', 'destination', 'active-database', 'active-storage'):
        restore.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        if args.operation == 'create':
            result = create_package(args.database, args.storage, args.destination)
        elif args.operation == 'verify':
            result = verify_package(args.package)
        else:
            result = restore_package(args.package, args.destination, active_database=args.active_database, active_storage=args.active_storage)
        print(json.dumps(result, indent=2))
    except RecoveryError as error:
        print('Recovery stopped: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
