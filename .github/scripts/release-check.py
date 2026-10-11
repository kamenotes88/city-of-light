"""Check an exported Project World preview without the private builder or sources."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile

MAX_BYTES = 50 * 1024 * 1024
BASE_FILES = {'Start.html', 'README.txt', 'INSTALL.md', 'install-world.py',
              'setup-world.cjs', 'project-world-skill.md', 'extensions.json'}
LEGAL_FILES = {'LICENSE', 'NOTICE'}
ARCHIVE = 'Project-World-Preview.zip'
HASH = re.compile(r'[a-f0-9]{64}')
PLACEHOLDER = re.compile(
    r'DRAFT_NOT_EFFECTIVE|NOT[_ ]EFFECTIVE|\bDRAFT\b|\bTODO\b|\bTBD\b|'
    r'PLACEHOLDER|RIGHTHOLDER_PENDING|\[(?:YEAR|NAME|RIGHTHOLDER|COPYRIGHT HOLDER)\]|'
    r'<(?:YEAR|NAME|RIGHTHOLDER|COPYRIGHT HOLDER)>|\{\{', re.I)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def object_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    value = json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique)
    require(isinstance(value, dict), 'Expected a JSON object')
    return value


def read_file(path, limit=MAX_BYTES):
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and not path.is_symlink()
            and not getattr(metadata, 'st_file_attributes', 0) & 1024,
            'Regular file required: ' + path.name)
    require(metadata.st_size <= limit, 'Size limit exceeded: ' + path.name)
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'Size limit exceeded: ' + path.name)
    return data


def snapshot(directory):
    return {str(path.relative_to(directory)): (sha(read_file(path)), path.stat().st_mtime_ns)
            for path in directory.rglob('*') if path.is_file()}


def artifact_checks(directory, public_ready):
    release_data = read_file(directory / 'install-release.json', 1024 * 1024)
    manifest_data = read_file(directory / 'manifest.json', 1024 * 1024)
    release, manifest = object_json(release_data), object_json(manifest_data)
    require(type(release.get('format_version')) is int and release['format_version'] == 1
            and release.get('product_id') == 'project-world'
            and release.get('channel') == 'preview'
            and re.fullmatch(r'\d+\.\d+\.\d+', str(release.get('engine_version', ''))),
            'Unsupported release identity/version')
    require(type(manifest.get('format_version')) is int and manifest['format_version'] == 1
            and manifest.get('engine_version') == release['engine_version']
            and manifest.get('channel') == release['channel']
            and type(manifest.get('profile_version')) is int and manifest['profile_version'] == 1
            and manifest.get('entrypoint') == 'Start.html'
            and manifest.get('network_required') is False
            and manifest.get('includes_user_data') is False
            and HASH.fullmatch(str(manifest.get('source_sha256', ''))),
            'Manifest identity/version/declared data boundary mismatch')
    records = manifest.get('files')
    require(isinstance(records, dict) and set(records) in (BASE_FILES, BASE_FILES | LEGAL_FILES),
            'Unexpected manifest file list')
    names = set(records) | {'manifest.json'}
    listed = release.get('payload_files')
    require(isinstance(listed, list) and all(isinstance(name, str) for name in listed)
            and len(listed) == len(names) and set(listed) == names,
            'Unexpected or duplicate release payload list')
    payload = {name: read_file(directory / name) for name in records}
    payload['manifest.json'] = manifest_data
    archive_record = release.get('archive')
    require(isinstance(archive_record, dict) and archive_record.get('href') == ARCHIVE
            and type(archive_record.get('bytes')) is int
            and 0 < archive_record['bytes'] <= MAX_BYTES
            and HASH.fullmatch(str(archive_record.get('sha256', ''))), 'Invalid archive record')
    archive_data = read_file(directory / ARCHIVE)
    require(sum(map(len, payload.values())) + len(release_data) + len(archive_data) <= MAX_BYTES,
            'Distribution budget exceeds 50 MiB')
    require(len(archive_data) == archive_record['bytes']
            and sha(archive_data) == archive_record['sha256'], 'Archive size/SHA256 mismatch')
    for name, record in records.items():
        require(isinstance(record, dict) and type(record.get('bytes')) is int
                and record['bytes'] == len(payload[name])
                and record.get('sha256') == sha(payload[name]), 'Manifest size/SHA256 mismatch: ' + name)
    with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
        members = archive.infolist()
        require(len(members) == len(names) and {info.filename for info in members} == names,
                'Unexpected or duplicate ZIP members')
        require(sum(info.file_size for info in members) <= MAX_BYTES, 'ZIP expansion exceeds 50 MiB')
        for info in members:
            require(not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG)
                    and not info.flag_bits & 1
                    and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    'Unsupported ZIP member: ' + info.filename)
            with archive.open(info) as stream:
                data = stream.read(min(info.file_size, MAX_BYTES) + 1)
            require(len(data) == info.file_size and data == payload[info.filename],
                    'Flat export/ZIP mismatch: ' + info.filename)
    legal = {}
    for field, default, allowed in [('license_status', 'DRAFT_NOT_EFFECTIVE', ('DRAFT_NOT_EFFECTIVE', 'EFFECTIVE')),
                                    ('provenance_status', 'PENDING', ('PENDING', 'REVIEWED'))]:
        legal[field] = release.get(field, default)
        require(legal[field] in allowed and manifest.get(field, default) == legal[field],
                'Manifest/release legal status mismatch: ' + field)
    if public_ready:
        require(set(records) == BASE_FILES | LEGAL_FILES and legal == {
            'license_status': 'EFFECTIVE', 'provenance_status': 'REVIEWED'},
            'Public-ready requires LICENSE/NOTICE and EFFECTIVE/REVIEWED metadata')
        for name, minimum in [('LICENSE', 300), ('NOTICE', 40)]:
            text = payload[name].decode('utf-8-sig').strip()
            require(len(text) >= minimum and not PLACEHOLDER.search(text),
                    'Public-ready refuses incomplete/draft/placeholder ' + name)
        require(re.search(r'^Copyright\b', payload['LICENSE'].decode('utf-8-sig'), re.I | re.M),
                'Public-ready requires a copyright notice in LICENSE')
    return release, manifest, payload, {'install-release.json': release_data, ARCHIVE: archive_data}, legal


def run(command, expected_status=None, refusal=None):
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=45)
    if refusal:
        require(result.returncode != 0 and refusal in result.stderr,
                'Expected refusal absent: ' + refusal)
        return None
    require(result.returncode == 0, 'Command failed: ' + result.stderr.strip())
    output = object_json(result.stdout.encode('utf-8'))
    require(output.get('status') == expected_status, 'Unexpected command status')
    return output


def runtime_checks(directory, node, served, release, locales):
    verify = run([node, str(directory / 'setup-world.cjs'), '--verify'], 'VERIFIED')
    require(verify.get('engine_version') == release['engine_version'], 'Node verified another version')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            data = served.get(self.path.lstrip('/'))
            if data is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix='project-world-release-qa-') as temporary:
                root = Path(temporary).resolve()
                require(root.parent == Path(tempfile.gettempdir()).resolve()
                        and root.name.startswith('project-world-release-qa-'), 'Temporary cleanup path mismatch')
                url = 'http://127.0.0.1:' + str(server.server_port) + '/install-release.json'
                def install(target, status=None, refusal=None):
                    return run([sys.executable, str(directory / 'install-world.py'),
                                '--release', url, '--target', str(target)], status, refusal)
                installed = root / 'installed'
                install(installed, 'INSTALLED')
                before = snapshot(installed)
                install(installed, 'ALREADY_INSTALLED')
                require(snapshot(installed) == before, 'Install repeat changed bytes/mtime')
                run([node, str(installed / 'setup-world.cjs'), '--verify'], 'VERIFIED')
                sentinel = root / 'existing-install'
                sentinel.mkdir()
                (sentinel / 'keep.txt').write_text('Existing customer files must survive.\n', encoding='utf-8')
                before = snapshot(sentinel)
                install(sentinel, refusal='preserved')
                require(snapshot(sentinel) == before, 'Installer changed sentinel directory')
                for language in locales:
                    answers = root / (language + '-answers.json')
                    answers.write_text(json.dumps({
                        'locale': {'version': 1, 'language': language, 'direction': 'ltr'},
                        'world': {'name': 'Release QA example', 'theme': 'garden', 'story': 'Fictional local test plan.'},
                        'goal': 'Prepare one useful example.', 'limits': 'No external access, spending or publication.',
                        'projects': [{'name': 'Example project', 'type': 'building', 'goal': 'Write an example',
                                      'criterion': 'One example is readable', 'next': 'Write one sentence'}],
                        'connectors': []}), encoding='utf-8')
                    world = root / (language + '-world')
                    command = [node, str(installed / 'setup-world.cjs'), '--answers', str(answers),
                               '--output', str(world), '--assistant', 'manual']
                    created = run(command, 'CREATED')
                    profile = object_json(read_file(world / 'world.profile.json'))
                    require(profile.get('worldId') == created.get('worldId')
                            and profile.get('locale', {}).get('language') == language
                            and len(profile.get('projects', [])) == 1 and not profile.get('connectors'),
                            'Created profile does not match fictional answers/locale')
                    before = snapshot(world)
                    repeated = run(command, 'ALREADY_CREATED')
                    require(snapshot(world) == before and repeated.get('worldId') == created['worldId'],
                            'World repeat changed bytes/mtime/identity')
                    with (world / 'My-Project-World.html').open('ab') as stream:
                        stream.write(b'\n<!-- Customer change -->\n')
                    before = snapshot(world)
                    run(command, refusal='EXISTING_FILE_MISMATCH')
                    require(snapshot(world) == before, 'Setup changed a modified customer world')
                with (installed / 'Start.html').open('ab') as stream:
                    stream.write(b'\n<!-- Customer change -->\n')
                before = snapshot(installed)
                install(installed, refusal='preserved')
                require(snapshot(installed) == before, 'Installer changed a modified installation')
        finally:
            server.shutdown()
            worker.join(timeout=5)
    return {'node_verify': 'PASS', 'loopback_install': 'PASS', 'install_repeat_hashes_mtime': 'PASS',
            'install_sentinel_preserved': 'PASS', 'modified_install_preserved': 'PASS',
            'world_create_repeat_modified_refusal': 'PASS', 'locales': locales}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.'), help='Flat exported preview root; read only')
    parser.add_argument('--node', default=shutil.which('node'), help='Installed Node executable')
    parser.add_argument('--locales', nargs='+', choices=['en', 'ru'], default=['en'])
    parser.add_argument('--public-ready', action='store_true', help='Require effective/reviewed complete legal payload')
    parser.add_argument('--artifacts-only', action='store_true', help='Skip local execution and loopback; never runtime PASS')
    args = parser.parse_args()
    try:
        directory = args.directory.resolve(strict=True)
        require(directory.is_dir(), 'Export directory required')
        release, manifest, payload, served, legal = artifact_checks(directory, args.public_ready)
        inputs = {name: (sha(read_file(directory / name)), (directory / name).stat().st_mtime_ns)
                  for name in set(payload) | set(served)}
        runtime = {'runtime_checks': 'NOT_RUN'}
        if not args.artifacts_only:
            require(args.node is not None, 'Install Node or pass --node; no automatic runtime install')
            runtime = runtime_checks(directory, args.node, served, release, list(dict.fromkeys(args.locales)))
        require(inputs == {name: (sha(read_file(directory / name)), (directory / name).stat().st_mtime_ns)
                           for name in inputs}, 'Checker changed exported input files')
        print(json.dumps({'status': 'PASS', 'engine_version': release['engine_version'],
                          'archive_sha256': release['archive']['sha256'], 'payload_count': len(payload),
                          'artifacts': 'PASS', 'export_hashes_mtime_preserved': 'PASS', **legal,
                          'public_ready_gate': 'PASS' if args.public_ready else 'NOT_RUN', **runtime,
                          'limitations': {'legal_authorship_rights': 'NOT_VERIFIED_BY_HASHES',
                                          'native_ai_skill': 'NOT_RUN', 'external_https_install': 'NOT_RUN',
                                          'independent_customer': 'NOT_RUN', 'github_actions_execution': 'NOT_RUN'}}, indent=2))
    except (OSError, ValueError, UnicodeError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, 'Release check refused: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
