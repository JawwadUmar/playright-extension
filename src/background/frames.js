const pending = new Map();

export function acceptFrameResult(message, sender) {
  const request = pending.get(message.token);
  if (!request || sender.tab?.id !== request.tabId || sender.frameId !== request.parentId) return false;
  pending.delete(message.token);
  clearTimeout(request.timer);
  request.resolve(message.result);
  return true;
}

async function locateFrame(tabId, childId, parentId) {
  const token = crypto.randomUUID();
  const result = new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(token);
      resolve(null);
    }, 1800);
    pending.set(token, { tabId, parentId, resolve, timer });
  });
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'prepare-frame', token }, { frameId: parentId });
    await chrome.tabs.sendMessage(tabId, { type: 'identify-frame', token }, { frameId: childId });
  } catch {
    const request = pending.get(token);
    if (request) {
      pending.delete(token);
      clearTimeout(request.timer);
      request.resolve(null);
    }
  }
  return result;
}

export async function resolveFramePath(sender) {
  if (!sender.tab || sender.frameId === 0) return { ok: true, steps: [], fragile: false };
  const frames = await chrome.webNavigation.getAllFrames({ tabId: sender.tab.id });
  const chain = [];
  let frame = frames?.find(item => item.frameId === sender.frameId);
  if (frame?.documentId && sender.documentId && frame.documentId !== sender.documentId) return { ok: false };
  while (frame && frame.frameId !== 0 && chain.length < 20) {
    chain.unshift(frame);
    frame = frames.find(item => item.frameId === frame.parentFrameId);
  }
  if (!frame || frame.frameId !== 0) return { ok: false };
  const steps = [];
  let fragile = false;
  for (const child of chain) {
    const locator = await locateFrame(sender.tab.id, child.frameId, child.parentFrameId);
    if (locator?.status !== 'verified' || !locator.identityVerified || locator.count !== 1) return { ok: false };
    steps.push(...locator.steps, { kind: 'frame' });
    fragile ||= locator.fragile;
  }
  return { ok: true, steps, fragile };
}
