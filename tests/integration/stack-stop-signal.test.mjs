/**
 * `docker compose stop` sends SIGTERM to each container's PID 1, here node, which has no
 * default signal handling as PID 1: the web server and the graphs sidecar ignored it and
 * Docker killed them at the stop timeout (exit 137). Runs throwaway containers from the
 * images the global setup just built, so the shared test stack keeps running.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const IMAGES = [
  { image: 'gitnexus-web-test:local', name: 'gnx-stop-web', ready: /gitnexus-web listening/ },
  { image: 'gitnexus-graphs-test:local', name: 'gnx-stop-graphs', ready: /\[graphs-sidecar\] listening/ },
];
const removeContainer = (name) => { try { docker('rm', '-f', name); } catch { /* not there */ } };

afterAll(() => IMAGES.forEach(({ name }) => removeContainer(name)));

describe('containers stop on SIGTERM', () => {
  for (const { image, name, ready } of IMAGES) {
    it(`${image} exits 0 on docker stop`, async () => {
      removeContainer(name);
      docker('run', '-d', '--name', name, image);
      for (let i = 0; i < 60 && !ready.test(docker('logs', name)); i++) await new Promise((r) => setTimeout(r, 500));
      expect(docker('logs', name)).toMatch(ready);
      docker('stop', '-t', '10', name);
      expect(docker('inspect', '-f', '{{.State.ExitCode}}', name)).toBe('0');
    });
  }
});
