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
              'setup-world.cjs', 'project-world-skill.md', 'extensions.json',
              'work-result.cjs', 'work-report.schema.json', 'world-history-core.js',
              'history-source.cjs', 'HISTORY_IMPORT.md', 'HISTORY_CONNECTORS.md'}
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


HISTORY_SMOKE = r'''
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const [startFile,worldFile,historyFile]=process.argv.slice(2);
const start=fs.readFileSync(startFile,'utf8'),matches=[...start.matchAll(/<script id="town-engine" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/g)];
assert.equal(matches.length,1);const engine=JSON.parse(matches[0][1]);
const html=fs.readFileSync(worldFile,'utf8'),boots=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter(m=>/^window\./.test(m[1])&&/\bwindow\.TownProfile=/.test(m[1]));
assert.equal(boots.length,1);assert.doesNotMatch(html,/owner-data\.json|owner-profile\.json|knowledge-index\.json|page_60fc8e0f53d88191a64023a74b92c409|page_f9a470356fd08191baf2ee20d3acd7b2/);
const globals=vm.createContext({window:{}});vm.runInContext(boots[0][1],globals);const boot=globals.window;
const context={TextEncoder,TextDecoder,URL,crypto:webcrypto,console};context.window=context;context.globalThis=context;vm.createContext(context);
context.__TownLocaleCatalogue=engine.locale_catalogue;context.__ProLocaleCatalogue=engine.pro.locale_catalogue;
for(const name of ['world-locale.js','world-core.js','world-history-core.js','pro-locale.js','pro-model.js','pro-package.js'])vm.runInContext(engine.assets[name],context,{filename:name,timeout:5000});
context.TownLocale.configure(engine.locale_catalogue);context.ProLocale.configure(engine.pro.locale_catalogue);context.TownLocale.select(boot.PRO_EMBEDDED_PROFILE.locale);context.ProLocale.select(boot.PRO_LOCALE);
(async()=>{
  const before=JSON.stringify(boot.PRO_EMBEDDED_DATA),data=boot.PRO_BUNDLE_CONTEXT.data,projects=boot.PRO_EMBEDDED_DATA.projects;
  const imported=context.TownHistoryCore.entries(data,projects);assert.equal(imported.length,2);assert.equal(imported.filter(r=>r.status==='accepted_local').length,1);assert.equal(imported.filter(r=>r.date===null).length,1);
  assert.equal(projects[0].achievements.length,0);assert.equal(projects[0].learning.xp,0);
  const feed=JSON.parse(fs.readFileSync(historyFile,'utf8'));const repeat=context.TownHistoryCore.merge(data,feed,projects);assert.equal(repeat.added,0);assert.equal(JSON.stringify(boot.PRO_EMBEDDED_DATA),before);
  const backup=await context.TownProPackage.createBackup({state:boot.PRO_EMBEDDED_DATA,profile:boot.PRO_EMBEDDED_PROFILE,bundleContext:boot.PRO_BUNDLE_CONTEXT,proLocale:boot.PRO_LOCALE,engineVersion:engine.engine_version});
  const restored=await context.TownProPackage.decodeBackup(JSON.stringify(backup),engine.engine_version);
  assert.equal(JSON.stringify(restored.proState),before);assert.equal(JSON.stringify(restored.data),JSON.stringify(data));
  for(const key of ['learning','graph','presentation','origin','attachments'])assert.equal(JSON.stringify(restored[key]),JSON.stringify(boot.PRO_BUNDLE_CONTEXT[key]));
  const restoredRepeat=context.TownHistoryCore.merge(restored.data,feed,restored.proState.projects);assert.equal(restoredRepeat.added,0);
  const copy=context.TownProPackage.buildHTML(engine,restored);assert.ok(copy.includes('restore-'));assert.ok(copy.includes('Fictional accepted source step'));assert.ok(copy.includes('Undated fictional step'));assert.doesNotMatch(copy,/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"/);
  const routeVersion=engine.engine_version.split('.').map(Number),hasRoute=routeVersion[0]>0||routeVersion[1]>15||(routeVersion[1]===15&&routeVersion[2]>=1);
  if(hasRoute){
  const M=context.ProModel,parent=projects[0].id;
  let routed=M.reduce(boot.PRO_EMBEDDED_DATA,'create',{name:'Fictional child task',goal:'Prepare one reviewed draft',criterion:'Readable draft',stages:['Inspect current source'],kind:'task',parentId:parent,approved:true});
  const id=routed.selectedProjectId,destination={version:1,provider:'codex',mode:'assistant_create',role:'executor',workspace:'fictional-workspace',hostProjectId:'fictional-saved-project'};
  routed=M.reduce(routed,'configureLaunch',{projectId:id,parentId:parent,destination});routed=M.reduce(routed,'prepareLaunch',{projectId:id});
  const request=M.launchRequest(routed,id);assert.equal(request.parentContext.projectId,parent);assert.equal(request.destination.hostProjectId,destination.hostProjectId);
  const answer={projectId:id,binding:request,confirmed:true,title:'Fictional actual chat',href:'https://example.test/working-chat'};
  const changed=M.reduce(routed,'plan',{projectId:id,goal:'Changed goal',criterion:'Changed success',stages:['Review'],approved:true});assert.throws(()=>M.reduce(changed,'bindLaunch',answer));
  const bound=M.reduce(routed,'bindLaunch',answer),project=bound.projects.find(p=>p.id===id);
  assert.equal(project.threads[0].status,'linked_not_connected');assert.equal(project.learning.xp,0);assert.equal(project.achievements.length,0);assert.notEqual(project.status,'completed_local');
  assert.equal(JSON.stringify(M.reduce(bound,'bindLaunch',answer)),JSON.stringify(bound));
  const routedBackup=await context.TownProPackage.createBackup({state:bound,profile:boot.PRO_EMBEDDED_PROFILE,bundleContext:boot.PRO_BUNDLE_CONTEXT,proLocale:boot.PRO_LOCALE,engineVersion:engine.engine_version});
  const routedRestore=await context.TownProPackage.decodeBackup(JSON.stringify(routedBackup),engine.engine_version);assert.equal(JSON.stringify(routedRestore.proState),JSON.stringify(bound));
  }
  console.log(JSON.stringify({status:'HISTORY_PASS',records:2,duplicate:'NO_CHANGE',full_backup_restore:'PASS',awards:'UNCHANGED',chat_route:{status:hasRoute?'PASS':'NOT_APPLICABLE',stale_binding:'REFUSED',repeat:'NO_CHANGE',backup:'EXACT',xp:0,completion:false,native_creation:'NOT_RUN'}}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
'''


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
                    if tuple(map(int, release['engine_version'].split('.'))) >= (0, 13, 0):
                        html = read_file(world / 'My-Project-World.html').decode('utf-8')
                        require('window.PRO_PUBLIC_MODE=true;' in html,
                                'New world did not use the public Pro interface')
                        require('window.PRO_EMBEDDED_PROFILE=' in html
                                and 'owner-data.json' not in html and 'owner-profile.json' not in html,
                                'Public Pro depends on owner sources')
                    before = snapshot(world)
                    repeated = run(command, 'ALREADY_CREATED')
                    require(snapshot(world) == before and repeated.get('worldId') == created['worldId'],
                            'World repeat changed bytes/mtime/identity')
                    if tuple(map(int, release['engine_version'].split('.'))) >= (0, 15, 0):
                        history = root / (language + '-selected-history.json')
                        history_value = {
                            'format': 'city-light-history-feed', 'version': 1,
                            'source': {'id': 'fictional-qa-chat', 'label': 'Permitted fictional QA chat',
                                       'revision': 1, 'updatedAt': '2026-10-12T00:00:00Z', 'kind': 'chat',
                                       'url': 'https://example.com/fictional-qa-chat'},
                            'records': [
                                {'id': 'local-step', 'projectId': profile['projects'][0]['id'],
                                 'title': 'Fictional accepted source step', 'detail': 'Local source evidence only.',
                                 'date': '2026-10-11', 'status': 'accepted_local', 'scope': 'Local source scope',
                                 'evidence': ['fictional/source.json']},
                                {'id': 'pending-step', 'projectId': profile['projects'][0]['id'],
                                 'title': 'Undated fictional step', 'detail': 'An unknown date stays unknown.',
                                 'date': None, 'status': 'pending', 'scope': 'Planned work', 'evidence': []}]}
                        history.write_text(json.dumps(history_value), encoding='utf-8')
                        history_world = root / (language + '-history-world')
                        history_command = [node, str(installed / 'setup-world.cjs'), '--answers', str(answers),
                                           '--output', str(history_world), '--assistant', 'manual',
                                           '--history', str(history)]
                        history_created = run(history_command, 'CREATED')
                        history_before = snapshot(history_world)
                        history_repeat = run(history_command, 'ALREADY_CREATED')
                        require(snapshot(history_world) == history_before
                                and history_repeat['worldId'] == history_created['worldId'],
                                'History setup repeat changed bytes/mtime/identity')
                        smoke = root / (language + '-history-smoke.cjs')
                        smoke.write_text(HISTORY_SMOKE, encoding='utf-8')
                        checked = run([node, str(smoke), str(installed / 'Start.html'),
                                       str(history_world / 'My-Project-World.html'), str(history)], 'HISTORY_PASS')
                        require(checked.get('records') == 2 and checked.get('duplicate') == 'NO_CHANGE'
                                and checked.get('full_backup_restore') == 'PASS'
                                and checked.get('awards') == 'UNCHANGED', 'History smoke did not prove preservation')
                        history.write_text('{malformed JSON', encoding='utf-8')
                        run(history_command, refusal='INVALID_JSON')
                        require(snapshot(history_world) == history_before,
                                'Malformed history changed an existing user world')
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
    history_status = 'PASS' if tuple(map(int, release['engine_version'].split('.'))) >= (0, 15, 0) else 'NOT_APPLICABLE'
    return {'node_verify': 'PASS', 'loopback_install': 'PASS', 'install_repeat_hashes_mtime': 'PASS',
            'install_sentinel_preserved': 'PASS', 'modified_install_preserved': 'PASS',
            'world_create_repeat_modified_refusal': 'PASS', 'history_create_repeat_backup_restore': history_status,
            'history_unknown_dates_and_awards_preserved': history_status,
            'history_malformed_input_preserves_existing_world': history_status,
            'chat_route_backup_stale_binding': 'PASS' if tuple(map(int, release['engine_version'].split('.'))) >= (0, 15, 1) else 'NOT_APPLICABLE', 'locales': locales}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.'), help='Flat exported preview root; read only')
    parser.add_argument('--root', type=Path, help='Alias for the flat exported preview root')
    parser.add_argument('--node', default=shutil.which('node'), help='Installed Node executable')
    parser.add_argument('--locales', nargs='+', choices=['en', 'ru'], default=['en'])
    parser.add_argument('--public-ready', action='store_true', help='Require effective/reviewed complete legal payload')
    parser.add_argument('--artifacts-only', action='store_true', help='Skip local execution and loopback; never runtime PASS')
    args = parser.parse_args()
    try:
        directory = (args.root or args.directory).resolve(strict=True)
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
