#!/usr/bin/env python3
"""Evaluate JavaScript in the eno app's WKWebView on a booted iOS SIMULATOR (WebKit remote inspector).

    python3 scripts/ios-sim-inspect.py <simulator-udid> '<js expression>'

Prints the expression's value as JSON on stdout (strings come back as JSON strings). Exit 1 when the
app or its page cannot be reached. Dependency-free: it speaks the WebKit Inspector Remote protocol
(binary plists over the simulator's webinspectord socket) directly.

Why this exists: there is no way to TAP the simulator headlessly here (idb has no companion, and
driving Simulator.app's window caused stray input and device shutdowns, measured 2026-10-04), so the
App Store capture (scripts/appstore-capture.sh) and the smoke checks in docs/ios-appstore-release.md
drive the page from inside: navigation, consent, scrolling and the regulated-copy scan all run as JS.

⚠️ ONLY A DEBUG BUILD IS INSPECTABLE. Capacitor turns WKWebView.isInspectable on for Debug; an
archive (Release) refuses the connection, which is correct for a store binary.
⚠️ WebKit's Runtime.evaluate does not await promises here — start async work, park the result on
`window`, and poll it with a second call (the capture script does exactly that).
"""
import json
import os
import plistlib
import socket
import struct
import subprocess
import sys
import time
import uuid

BUNDLE = os.environ.get('ENO_IOS_BUNDLE', 'vn.eno.app')


def inspector_socket(udid: str) -> str:
    """The webinspectord socket is held open by THAT simulator's launchd_sim; older boots leave
    stale sockets behind in /private/tmp, so pick by process, never by `ls -t`."""
    ps = subprocess.run(['ps', '-ax', '-o', 'pid=,command='], capture_output=True, text=True).stdout
    pids = [line.split(None, 1)[0] for line in ps.splitlines() if 'launchd_sim' in line and udid in line]
    for pid in pids:
        out = subprocess.run(['lsof', '-p', pid, '-U'], capture_output=True, text=True).stdout
        for line in out.splitlines():
            if 'webinspectord_sim.socket' in line:
                return line.split()[-1]
    sys.exit(f'no web inspector socket for simulator {udid} — is it booted?')


class Wir:
    def __init__(self, path: str):
        self.conn = str(uuid.uuid4()).upper()
        self.sender = str(uuid.uuid4()).upper()
        self.buf = b''
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.connect(path)
        self.s.settimeout(15)

    def send(self, selector: str, arg: dict) -> None:
        arg = dict(arg, WIRConnectionIdentifierKey=self.conn)
        data = plistlib.dumps({'__selector': selector, '__argument': arg}, fmt=plistlib.FMT_BINARY)
        self.s.sendall(struct.pack('>I', len(data)) + data)

    def recv(self) -> dict:
        while True:
            if len(self.buf) >= 4:
                n = struct.unpack('>I', self.buf[:4])[0]
                if len(self.buf) >= 4 + n:
                    msg = plistlib.loads(self.buf[4:4 + n])
                    self.buf = self.buf[4 + n:]
                    return msg
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError('inspector socket closed')
            self.buf += chunk

    def wait_for(self, selector: str, seconds: float = 15) -> dict:
        end = time.time() + seconds
        while time.time() < end:
            m = self.recv()
            if m.get('__selector') == selector:
                return m
        raise TimeoutError(selector)


def evaluate(udid: str, expr: str):
    w = Wir(inspector_socket(udid))
    w.send('_rpc_reportIdentifier:', {})
    w.send('_rpc_getConnectedApplications:', {})
    apps = w.wait_for('_rpc_reportConnectedApplicationList:')['__argument']['WIRApplicationDictionaryKey']
    # The simulator reports a Capacitor app as `process-App` (its executable), not by bundle id.
    ours = lambda v: v.get('WIRApplicationBundleIdentifierKey') in (BUNDLE, 'process-App') or v.get('WIRApplicationNameKey') == 'App'
    app_id = next((k for k, v in apps.items() if ours(v)), None)
    end = time.time() + 10
    while app_id is None and time.time() < end:
        try:
            m = w.recv()
        except (TimeoutError, socket.timeout):
            break  # nothing announced itself — fall through to the clear error below
        if m.get('__selector') == '_rpc_applicationConnected:' and ours(m['__argument']):
            app_id = m['__argument']['WIRApplicationIdentifierKey']
    if app_id is None:
        sys.exit(f'{BUNDLE} is not running or not inspectable (a Release build never is)')
    w.send('_rpc_forwardGetListing:', {'WIRApplicationIdentifierKey': app_id})
    listing = w.wait_for('_rpc_applicationSentListing:')['__argument']['WIRListingKey']
    # The app's own page first: https (the live site), then the local offline page.
    rank = lambda v: 2 if (v.get('WIRURLKey') or '').startswith('https://') else 1 if (v.get('WIRURLKey') or '').startswith('capacitor://') else 0
    pages = sorted(listing.values(), key=rank, reverse=True)
    if not pages:
        sys.exit('the app has no inspectable page yet')
    page_id = pages[0]['WIRPageIdentifierKey']
    base = {'WIRApplicationIdentifierKey': app_id, 'WIRPageIdentifierKey': page_id, 'WIRSenderKey': w.sender}
    w.send('_rpc_forwardSocketSetup:', dict(base, WIRAutomaticallyPause=False))

    def send_data(obj):
        w.send('_rpc_forwardSocketData:', dict(base, WIRSocketDataKey=json.dumps(obj).encode()))

    def next_data(seconds=15):
        end = time.time() + seconds
        while time.time() < end:
            m = w.recv()
            if m.get('__selector') == '_rpc_applicationSentData:':
                return json.loads(m['__argument']['WIRMessageDataKey'])
        raise TimeoutError('no data from the page')

    target = None
    end = time.time() + 8
    while target is None and time.time() < end:
        try:
            d = next_data(8)
        except TimeoutError:
            break
        if d.get('method') == 'Target.targetCreated':
            target = d['params']['targetInfo']['targetId']
    inner = {'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}
    if target:
        send_data({'id': 100, 'method': 'Target.sendMessageToTarget', 'params': {'targetId': target, 'message': json.dumps(inner)}})
    else:
        send_data(inner)
    end = time.time() + 20
    while time.time() < end:
        d = next_data(20)
        r = json.loads(d['params']['message']) if d.get('method') == 'Target.dispatchMessageFromTarget' else d
        if r.get('id') == 1:
            res = r.get('result', {})
            if res.get('wasThrown'):
                sys.exit('page threw: ' + json.dumps(res.get('result'), ensure_ascii=False))
            return res.get('result', {}).get('value')
    raise TimeoutError('no answer to Runtime.evaluate')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(json.dumps(evaluate(sys.argv[1], sys.argv[2]), ensure_ascii=False))
