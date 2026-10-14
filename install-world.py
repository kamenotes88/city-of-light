"""Verify and unpack a Project World preview. Never execute downloaded code."""
import argparse
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler
import zipfile

MAX_BYTES = 50 * 1024 * 1024
JSON_BYTES = 1024 * 1024
PAYLOAD_FILES = ('Start.html', 'README.txt', 'INSTALL.md', 'setup-world.cjs',
                 'install-world.py', 'project-world-skill.md', 'extensions.json',
                 'LICENSE', 'NOTICE', 'work-result.cjs', 'work-report.schema.json',
                 'world-history-core.js', 'history-source.cjs', 'HISTORY_IMPORT.md', 'HISTORY_CONNECTORS.md', 'run-world.cjs', 'native-bridge-core.cjs', 'native-bridge-codex.cjs', 'work-report-core.js', 'live-history-service.cjs', 'plan-proposal-core.js', 'plan-proposal.schema.json', 'manifest.json')
RECEIPT = 'install-receipt.json'


class InstallError(ValueError):
    pass


def fail(message):
    raise InstallError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_object(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    try:
        result = json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError) as error:
        fail('Invalid JSON: ' + str(error))
    if not isinstance(result, dict):
        fail('Expected a JSON object')
    return result


def read_limited(stream, limit):
    chunks, count = [], 0
    while True:
        chunk = stream.read(min(65536, limit - count + 1))
        if not chunk:
            return b''.join(chunks)
        count += len(chunk)
        if count > limit:
            fail('Size limit exceeded')
        chunks.append(chunk)


def safe_url(value):
    parts = urlsplit(value)
    if parts.scheme not in ('https', 'http') or not parts.hostname:
        fail('Use HTTPS, or HTTP on loopback only')
    if parts.username is not None or parts.password is not None or parts.fragment:
        fail('URL credentials and fragments are not supported')
    try:
        parts.port
    except ValueError:
        fail('Invalid URL port')
    if parts.scheme == 'http':
        try:
            local = ipaddress.ip_address(parts.hostname).is_loopback
        except ValueError:
            local = parts.hostname.lower() == 'localhost'
        if not local:
            fail('Public HTTP is not allowed')
    decoded = parts.path
    for _ in range(4):
        previous, decoded = decoded, unquote(decoded)
        if decoded == previous:
            break
    if '%' in decoded or '\\' in decoded or any(part in ('.', '..') for part in decoded.split('/')):
        fail('URL path traversal is not allowed')
    return parts


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail('Redirects are not allowed; use the final release URL')


def download(url, limit):
    safe_url(url)
    with build_opener(NoRedirects).open(url, timeout=30) as response:
        return read_limited(response, limit)


def load_release(source):
    if '://' in str(source):
        safe_url(str(source))
        release = json_object(download(str(source), JSON_BYTES))
        parent = str(source)
    else:
        path = guard_target(source)
        with path.open('rb') as stream:
            release = json_object(read_limited(stream, JSON_BYTES))
        parent = path.parent
    if (release.get('format_version') != 1 or release.get('product_id') != 'project-world'
            or release.get('channel') != 'preview'
            or not re.fullmatch(r'\d+\.\d+\.\d+', str(release.get('engine_version', '')))):
        fail('Unsupported release identity or version')
    names = release.get('payload_files')
    if (not isinstance(names, list) or not all(isinstance(name, str) for name in names)
            or len(names) != len(PAYLOAD_FILES) or set(names) != set(PAYLOAD_FILES)):
        fail('Unexpected release payload list')
    archive = release.get('archive')
    if not isinstance(archive, dict) or archive.get('href') != 'Project-World-Preview.zip':
        fail('Archive must be the relative Project-World-Preview.zip file')
    if type(archive.get('bytes')) is not int or not 0 < archive['bytes'] <= MAX_BYTES:
        fail('Invalid archive size or size limit exceeded')
    if not re.fullmatch(r'[a-f0-9]{64}', str(archive.get('sha256', ''))):
        fail('Invalid archive SHA256')
    if isinstance(parent, str):
        archive_source = urljoin(parent, archive['href'])
        if urlsplit(archive_source)[:2] != urlsplit(parent)[:2]:
            fail('Archive must use the release origin')
        data = download(archive_source, MAX_BYTES)
    else:
        path = guard_target(parent / archive['href'])
        if path.parent != parent:
            fail('Archive may not leave the release directory')
        with path.open('rb') as stream:
            data = read_limited(stream, MAX_BYTES)
    if len(data) != archive['bytes'] or sha(data) != archive['sha256']:
        fail('Archive bytes or SHA256 mismatch')
    return release, data


def verified_payload(release, data):
    payload = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) != len(PAYLOAD_FILES) or {info.filename for info in members} != set(PAYLOAD_FILES):
                fail('Unexpected or duplicate archive members')
            total = 0
            for info in members:
                kind = stat.S_IFMT(info.external_attr >> 16)
                if (info.is_dir() or kind not in (0, stat.S_IFREG) or info.flag_bits & 1
                        or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                    fail('Unsupported archive member: ' + info.filename)
                total += info.file_size
                if total > MAX_BYTES:
                    fail('Extracted size limit exceeded')
                with archive.open(info) as stream:
                    content = read_limited(stream, min(info.file_size, MAX_BYTES))
                if len(content) != info.file_size:
                    fail('Extracted size mismatch')
                payload[info.filename] = content
    except (zipfile.BadZipFile, RuntimeError, EOFError) as error:
        fail('Invalid archive: ' + str(error))
    manifest = json_object(payload['manifest.json'])
    if (manifest.get('format_version') != 1
            or manifest.get('engine_version') != release['engine_version']
            or manifest.get('channel') != release['channel']):
        fail('Manifest release identity mismatch')
    records = manifest.get('files')
    if not isinstance(records, dict) or set(records) != set(PAYLOAD_FILES) - {'manifest.json'}:
        fail('Unexpected manifest payload list')
    for name, record in records.items():
        if (not isinstance(record, dict) or type(record.get('bytes')) is not int
                or record['bytes'] != len(payload[name]) or record.get('sha256') != sha(payload[name])):
            fail('Manifest bytes or SHA256 mismatch: ' + name)
    for field, default, allowed in [('license_status', 'DRAFT_NOT_EFFECTIVE', ('DRAFT_NOT_EFFECTIVE', 'EFFECTIVE')),
                                    ('provenance_status', 'PENDING', ('PENDING', 'REVIEWED'))]:
        if release.get(field, default) not in allowed or manifest.get(field, default) != release.get(field, default):
            fail('Manifest license or provenance status mismatch')
    return payload


def guard_target(target):
    target = Path(os.path.abspath(target))
    for path in [*reversed(target.parents), target]:
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if (stat.S_ISLNK(metadata.st_mode)
                or getattr(metadata, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024)):
            fail('Symlink or reparse-point target paths are not allowed')
    if not target.parent.is_dir():
        fail('The target parent directory must already exist')
    return target


def install(source, destination):
    target = guard_target(destination)
    release, archive = load_release(source)
    payload = verified_payload(release, archive)
    hashes = {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in payload.items()}
    receipt = {'format_version': 1, 'product_id': 'project-world',
               'engine_version': release['engine_version'], 'channel': release['channel'],
               'license_status': release.get('license_status', 'DRAFT_NOT_EFFECTIVE'),
               'provenance_status': release.get('provenance_status', 'PENDING'),
               'archive_sha256': sha(archive), 'payload_files': hashes,
               'status': 'INSTALLED', 'accounts_connected': False, 'package_code_executed': False}
    target = guard_target(target)
    if target.exists():
        if not target.is_dir() or {path.name for path in target.iterdir()} != set(PAYLOAD_FILES) | {RECEIPT}:
            fail('Existing target is not a matching installation; preserved')
        for name in (*PAYLOAD_FILES, RECEIPT):
            path = target / name
            guard_target(path)
            if not path.is_file():
                fail('Installed payload is not a regular file; preserved')
        with (target / RECEIPT).open('rb') as stream:
            saved = json_object(read_limited(stream, JSON_BYTES))
        if saved != receipt:
            fail('Existing installation receipt differs; preserved')
        for name, expected in hashes.items():
            with (target / name).open('rb') as stream:
                actual = read_limited(stream, MAX_BYTES)
            if len(actual) != expected['bytes'] or sha(actual) != expected['sha256']:
                fail('Installed payload modified; preserved: ' + name)
        return {**receipt, 'status': 'ALREADY_INSTALLED', 'target': str(target)}
    stage = Path(tempfile.mkdtemp(prefix='.' + target.name + '.install-', dir=target.parent))
    try:
        for name, content in payload.items():
            (stage / name).write_bytes(content)
        (stage / RECEIPT).write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        guard_target(target)
        if target.exists():
            fail('Target appeared during installation; preserved')
        stage.rename(target)
        return {**receipt, 'target': str(target)}
    finally:
        # Only the unique temporary directory created by this invocation is removed.
        if stage.exists():
            guard_target(stage)
            if stage.parent != target.parent or not stage.name.startswith('.' + target.name + '.install-'):
                fail('Staging cleanup path mismatch')
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.release, args.target), indent=2))
    except (InstallError, OSError, ValueError) as error:
        parser.exit(1, 'Installation refused: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
