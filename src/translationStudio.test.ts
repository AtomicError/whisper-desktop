import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hardsub', () => ({ hardsubController: {} }));

let TranslationStudioController: typeof import('./translationStudio').TranslationStudioController;
const invoke = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeAll(async () => {
  vi.stubGlobal('document', { readyState: 'loading', addEventListener: vi.fn() });
  vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
  ({ TranslationStudioController } = await import('./translationStudio'));
});

afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { invoke.mockReset(); });

describe('subtitle loading', () => {
  it('ignores an older text read that finishes after the newer file loads', async () => {
    const firstRead = deferred<string>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return filePath === '/A.txt' ? firstRead.promise : Promise.resolve('BBBB');
      if (cmd === 'get_file_size') return Promise.resolve(4);
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    await controller.loadSubtitleFile('/B.txt');
    firstRead.resolve('AAA');
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleRawText: 'BBBB' });
    expect(invoke).not.toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' });
  });

  it('keeps the newest file and its contents together when size lookups finish out of order', async () => {
    const firstSize = deferred<number>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return Promise.resolve(filePath === '/A.txt' ? 'AAA' : 'BBBB');
      if (cmd === 'get_file_size') return filePath === '/A.txt' ? firstSize.promise : Promise.resolve(4);
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' }));
    expect(controller.state.subtitlePath).toBe('');
    await controller.loadSubtitleFile('/B.txt');
    firstSize.resolve(3);
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleName: 'B.txt', subtitleRawText: 'BBBB', subtitleSize: 4 });
    expect(controller.state.sourceCues[0].text).toBe('BBBB');
  });

  it('does not restore a subtitle cleared during its size lookup', async () => {
    const size = deferred<number>();
    invoke.mockImplementation(cmd => cmd === 'read_text_file_content' ? Promise.resolve('AAA') : size.promise);
    const controller = new TranslationStudioController();
    const loading = controller.loadSubtitleFile('/A.txt');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' }));
    controller.clearLoadedSubtitle();
    size.resolve(3);
    await loading;
    expect(controller.state).toMatchObject({ subtitlePath: '', subtitleRawText: '', subtitleSize: 0, sourceCues: [], companionVideoPath: null });
  });

  it.each([true, false])('ignores a stale companion probe after clearing (success: %s)', async success => {
    const probe = deferred<unknown>();
    invoke.mockImplementation(cmd => {
      if (cmd === 'read_text_file_content') return Promise.resolve('AAA');
      if (cmd === 'get_file_size') return Promise.resolve(3);
      return probe.promise;
    });
    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/A.txt');
    expect(invoke).toHaveBeenCalledWith('probe_media_file', { filePath: '/A.mp4' });
    controller.clearLoadedSubtitle();
    if (success) probe.resolve({});
    else probe.reject(new Error('Not found'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller.state.companionVideoPath).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'probe_media_file')).toHaveLength(1);
  });

  it.each([12, null])('uses disk bytes or UTF-8 fallback for Persian text (size: %s)', async size => {
    invoke.mockImplementation(cmd => {
      if (cmd === 'read_text_file_content') return Promise.resolve('سلام');
      if (cmd === 'get_file_size' && size !== null) return Promise.resolve(size);
      return Promise.reject(new Error('Unavailable'));
    });
    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/A.txt');
    expect(controller.state.subtitleSize).toBe(size ?? 8);
  });
});
