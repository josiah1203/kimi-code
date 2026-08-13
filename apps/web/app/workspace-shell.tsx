'use client';

import { BrowserPlatformError } from '@spiderbyte/client/browser';
import { useAuth, useOrganization, useUser } from '@clerk/nextjs';
import type {
  CollaborationChannel as PlatformCollaborationChannel,
  CollaborationMessage as PlatformCollaborationMessage,
  CollaborationThread,
  Project,
  Run,
  Session,
  Workspace,
  ApprovalRequest,
  ApprovalResponse,
} from '@spiderbyte/protocol';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  createSpiderByteWebClient,
  type SpiderByteWebClient,
} from '@/lib/spiderbyte-web-client';

type PlatformStatus = 'loading' | 'ready' | 'degraded' | 'unavailable';
type RealtimeStatus = 'connecting' | 'connected' | 'polling' | 'unavailable';
type MessageRole = 'user' | 'agent' | 'system';
type MessageState = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

interface UiCollaborationMessage {
  readonly id: string;
  readonly author: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly state?: MessageState;
  readonly runId?: string;
}

const fallbackChannel: PlatformCollaborationChannel = {
  id: 'unavailable',
  workspace_id: 'unavailable',
  kind: 'public',
  name: 'general',
  description: 'Collaboration channels are loading from SpiderByte.',
  state: 'active',
  member_ids: [],
  created_by: 'system',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  last_sequence: 0,
};

export function WorkspaceShell({ firstName }: { readonly firstName: string }) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { user } = useUser();
  const client = useMemo<SpiderByteWebClient>(
    () => createSpiderByteWebClient(async () => (await getToken()) ?? undefined),
    [getToken],
  );
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [project, setProject] = useState<Project | undefined>();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [session, setSession] = useState<Session | undefined>();
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<readonly ApprovalRequest[]>([]);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [artifactCount, setArtifactCount] = useState<number | undefined>();
  const [messages, setMessages] = useState<readonly UiCollaborationMessage[]>(() => [
    systemMessage('Select an authorized workspace to connect this conversation to SpiderByte Agent Core.'),
  ]);
  const [channels, setChannels] = useState<readonly PlatformCollaborationChannel[]>([]);
  const [threads, setThreads] = useState<readonly CollaborationThread[]>([]);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [composer, setComposer] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRunAction, setIsRunAction] = useState(false);
  const [pendingMessageLink, setPendingMessageLink] = useState<{
    readonly workspaceId: string;
    readonly channelId: string;
    readonly messageId: string;
    readonly sessionId: string;
  }>();
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus>('loading');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('polling');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [dataNotice, setDataNotice] = useState<string | undefined>();

  const selectedWorkspace = workspaces.find((item) => item.id === selectedWorkspaceId);
  const activeChannel = channels.find((item) => item.id === activeChannelId) ?? channels[0] ?? fallbackChannel;
  const activeThread = threads.find((item) => item.id === activeThreadId) ?? threads[0];
  const latestRun = useMemo(
    () => runs.toSorted((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0],
    [runs],
  );
  const latestRunMessage = useMemo(
    () => latestRun === undefined
      ? undefined
      : messages.toReversed().find((message) => message.runId === latestRun.id),
    [latestRun, messages],
  );
  const displayName = user?.fullName ?? user?.username ?? firstName;

  const loadWorkspaces = useCallback(async () => {
    setPlatformStatus('loading');
    setErrorMessage(undefined);
    try {
      const available = await client.listWorkspaces();
      setWorkspaces(available);
      const configuredId = process.env.NEXT_PUBLIC_SPIDERBYTE_WORKSPACE_ID;
      setSelectedWorkspaceId((current) => {
        if (current && available.some((item) => item.id === current)) return current;
        if (configuredId && available.some((item) => item.id === configuredId)) return configuredId;
        return available[0]?.id;
      });
      setPlatformStatus('ready');
    } catch (error) {
      setPlatformStatus(error instanceof BrowserPlatformError && error.code === 503 ? 'unavailable' : 'degraded');
      setErrorMessage(platformErrorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    let cancelled = false;
    setSession(undefined);
    setRuns([]);
    setPendingApprovals([]);
    setProject(undefined);
    setChannels([]);
    setThreads([]);
    setActiveChannelId('general');
    setActiveThreadId(undefined);
    setNewThreadTitle('');
    setPendingMessageLink(undefined);
    setMessages([systemMessage(`Welcome to ${selectedWorkspace.name}. Start a thread when you are ready to run an agent.`)]);
    setDataNotice(undefined);

    void client.getWorkspaceProject(selectedWorkspace.id).then(setProject).catch(() => setProject(undefined));

    const configuredSessionId = process.env.NEXT_PUBLIC_SPIDERBYTE_SESSION_ID;
    if (!configuredSessionId) return;

    void client.getSession(configuredSessionId).then((candidate) => {
      if (cancelled) return;
      if (candidate?.workspace_id !== selectedWorkspace.id) {
        setDataNotice('The configured session belongs to another workspace and was not opened.');
        return;
      }
      setSession(candidate);
    }).catch((error: unknown) => {
      if (!cancelled) setDataNotice(`Session unavailable: ${platformErrorMessage(error)}`);
    });

    return () => {
      cancelled = true;
    };
  }, [client, selectedWorkspace]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    let cancelled = false;
    void client.listCollaborationChannels(selectedWorkspace.id).then((available) => {
      if (cancelled) return;
      setChannels(available);
      setActiveChannelId((current) => available.some((channel) => channel.id === current)
        ? current
        : available[0]?.id ?? '');
      if (available.length === 0) {
        setDataNotice('No collaboration channels are available for this workspace.');
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      setChannels([]);
      setDataNotice(`Collaboration channels are unavailable: ${platformErrorMessage(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [client, selectedWorkspace]);

  useEffect(() => {
    if (!selectedWorkspace || channels.length === 0 || !channels.some((channel) => channel.id === activeChannel.id)) return;
    let cancelled = false;
    setThreads([]);
    setActiveThreadId(undefined);
    setMessages([systemMessage(`Welcome to #${activeChannel.name}. Select or create a thread to continue.`)]);
    void client.listCollaborationThreads(selectedWorkspace.id, activeChannel.id).then((page) => {
      if (cancelled) return;
      setThreads(page.items);
      setActiveThreadId((current) => page.items.some((thread) => thread.id === current)
        ? current
        : page.items[0]?.id);
    }).catch((error: unknown) => {
      if (!cancelled) setDataNotice(`Collaboration threads are unavailable: ${platformErrorMessage(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [activeChannel.id, channels, client, selectedWorkspace]);

  const refreshRuns = useCallback(async (workspaceId: string, sessionId: string): Promise<readonly Run[]> => {
    try {
      const nextRuns = await client.platform.workspace(workspaceId).listRuns(sessionId);
      setRuns(nextRuns);
      setDataNotice(undefined);
      return nextRuns;
    } catch (error) {
      setDataNotice(`Run state is unavailable: ${platformErrorMessage(error)}`);
      return [];
    }
  }, [client]);

  const refreshTranscript = useCallback(async (workspaceId: string, sessionId: string) => {
    try {
      const page = await client.getTranscript(workspaceId, sessionId, { pageSize: 60 });
      if (!page) return;
      const projected = page.items
        .map((item, index) => projectTranscriptItem(item, index))
        .filter((item): item is UiCollaborationMessage => item !== undefined);
      if (projected.length === 0) return;
      setMessages((current) => mergeMessages(current, projected));
    } catch (error) {
      setDataNotice(`Transcript catch-up is unavailable: ${platformErrorMessage(error)}`);
    }
  }, [client]);

  const refreshApprovals = useCallback(async (sessionId: string) => {
    try {
      setPendingApprovals(await client.listPendingApprovals(sessionId));
    } catch (error) {
      setPendingApprovals([]);
      setDataNotice(`Approval state is unavailable: ${platformErrorMessage(error)}`);
    }
  }, [client]);

  const refreshCollaborationMessages = useCallback(async (
    workspaceId: string,
    channelId: string,
    threadId: string,
  ) => {
    try {
      const page = await client.listCollaborationMessages(workspaceId, channelId, {
        limit: 100,
        threadId,
      });
      const projected = page.items.map(projectCollaborationMessage);
      if (projected.length > 0) setMessages((current) => mergeMessages(current, projected));
    } catch (error) {
      setDataNotice(`Collaboration messages are unavailable: ${platformErrorMessage(error)}`);
    }
  }, [client]);

  useEffect(() => {
    if (!selectedWorkspace || !activeThread) return;
    void refreshCollaborationMessages(selectedWorkspace.id, activeChannel.id, activeThread.id);
    if (session) {
      void refreshRuns(selectedWorkspace.id, session.id);
      void refreshTranscript(selectedWorkspace.id, session.id);
      void refreshApprovals(session.id);
    }
    const interval = window.setInterval(() => {
      void refreshCollaborationMessages(selectedWorkspace.id, activeChannel.id, activeThread.id);
      if (session) {
        void refreshRuns(selectedWorkspace.id, session.id);
        void refreshTranscript(selectedWorkspace.id, session.id);
        void refreshApprovals(session.id);
      }
    }, 4_000);
    return () => window.clearInterval(interval);
  }, [activeChannel.id, activeThread, refreshApprovals, refreshCollaborationMessages, refreshRuns, refreshTranscript, selectedWorkspace, session]);

  useEffect(() => {
    if (!pendingMessageLink || !latestRun) return;
    let cancelled = false;
    void client.updateCollaborationMessage(
      pendingMessageLink.workspaceId,
      pendingMessageLink.channelId,
      pendingMessageLink.messageId,
      {
        session_id: pendingMessageLink.sessionId,
        run_id: latestRun.id,
        state: messageStateForRun(latestRun.status),
      },
    ).then((updated) => {
      if (cancelled) return;
      setMessages((current) => mergeMessages(current, [projectCollaborationMessage(updated)]));
      setPendingMessageLink(undefined);
    }).catch(() => {
      // The next durable REST catch-up can retry this link without losing the
      // already-persisted collaboration message.
    });
    return () => {
      cancelled = true;
    };
  }, [client, latestRun, pendingMessageLink]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    let cancelled = false;
    void client.platform.workspace(selectedWorkspace.id).listArtifacts().then((artifacts) => {
      if (!cancelled) setArtifactCount(artifacts.length);
    }).catch(() => {
      if (!cancelled) setArtifactCount(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [client, selectedWorkspace]);

  useEffect(() => {
    if (!selectedWorkspace || !process.env.NEXT_PUBLIC_SPIDERBYTE_WS_URL) {
      setRealtimeStatus('polling');
      return;
    }
    setRealtimeStatus('connecting');
    try {
      const subscription = client.subscribeEvents(
        selectedWorkspace.id,
        {
          onEvent: () => {
            setRealtimeStatus('connected');
            if (activeThread) {
              void refreshCollaborationMessages(selectedWorkspace.id, activeChannel.id, activeThread.id);
            }
            if (session) {
              void refreshRuns(selectedWorkspace.id, session.id);
              void refreshTranscript(selectedWorkspace.id, session.id);
              void refreshApprovals(session.id);
            }
          },
          onError: () => setRealtimeStatus('polling'),
          onGap: () => setDataNotice('Realtime event gap detected; transcript and run state are catching up from REST.'),
        },
        { reconnect: true },
      );
      return () => subscription.dispose();
    } catch {
      setRealtimeStatus('polling');
    }
  }, [activeChannel.id, activeThread, client, refreshApprovals, refreshCollaborationMessages, refreshRuns, refreshTranscript, selectedWorkspace, session]);

  useEffect(() => {
    if (
      !selectedWorkspace ||
      !activeThread ||
      activeChannel.id === fallbackChannel.id ||
      !process.env.NEXT_PUBLIC_SPIDERBYTE_WS_URL
    ) return;
    try {
      const subscription = client.subscribeCollaboration(
        selectedWorkspace.id,
        activeChannel.id,
        {
          onMessage: (message) => {
            setRealtimeStatus('connected');
            setMessages((current) => mergeMessages(current, [projectCollaborationMessage(message)]));
          },
          onError: () => setRealtimeStatus('polling'),
          onGap: () => setDataNotice('Collaboration message gap detected; the thread is catching up from REST.'),
        },
        { threadId: activeThread.id, reconnect: true },
      );
      return () => subscription.dispose();
    } catch {
      setRealtimeStatus('polling');
    }
  }, [activeChannel.id, activeThread, client, selectedWorkspace]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = composer.trim();
    if (!text || isSubmitting) return;
    if (!selectedWorkspace) {
      setErrorMessage('Choose an authorized workspace before sending an instruction.');
      return;
    }
    if (activeChannel.id === fallbackChannel.id || activeThread === undefined) {
      setErrorMessage('Choose an available collaboration thread before sending an instruction.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(undefined);
    const optimisticId = `local:${Date.now().toString(36)}`;
    const channel = activeChannel;
    const thread = activeThread;
    const optimistic: UiCollaborationMessage = {
      id: optimisticId,
      author: displayName,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      state: 'queued',
    };
    setMessages((current) => [...current, optimistic]);
    setComposer('');

    let persistedMessage: PlatformCollaborationMessage | undefined;
    try {
      const activeSession = session ?? await client.createSession(selectedWorkspace.id, `${channel.name} thread`);
      if (!session) setSession(activeSession);
      const command = await client.submitCollaborationCommand(selectedWorkspace.id, channel.id, {
        session_id: activeSession.id,
        client_message_id: makeClientMessageId(),
        thread_id: thread.id,
        content: text,
        metadata: {
          source: 'spiderbyte-web',
          collaboration_projection: true,
        },
      });
      persistedMessage = command.message;
      setMessages((current) => mergeMessages(
        current.filter((item) => item.id !== optimisticId),
        [projectCollaborationMessage(command.message)],
      ));
      await refreshRuns(selectedWorkspace.id, activeSession.id);
      if (command.run_id === undefined && command.message.state !== 'failed') {
        setPendingMessageLink({
          workspaceId: selectedWorkspace.id,
          channelId: channel.id,
          messageId: command.message.id,
          sessionId: activeSession.id,
        });
      }
      await refreshTranscript(selectedWorkspace.id, activeSession.id);
    } catch (error) {
      if (persistedMessage !== undefined) {
        try {
          const failedMessage = await client.updateCollaborationMessage(selectedWorkspace.id, channel.id, persistedMessage.id, {
            state: 'failed',
          });
          setMessages((current) => mergeMessages(current, [projectCollaborationMessage(failedMessage)]));
        } catch {
          setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, state: 'failed' } : item));
        }
      } else {
        setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, state: 'failed' } : item));
      }
      setErrorMessage(platformErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newThreadTitle.trim();
    if (!selectedWorkspace || activeChannel.id === fallbackChannel.id || !title || isCreatingThread) return;
    setIsCreatingThread(true);
    setErrorMessage(undefined);
    try {
      const created = await client.createCollaborationThread(selectedWorkspace.id, activeChannel.id, title);
      setThreads((current) => [created, ...current.filter((thread) => thread.id !== created.id)]);
      setActiveThreadId(created.id);
      setNewThreadTitle('');
    } catch (error) {
      setErrorMessage(`Thread creation failed: ${platformErrorMessage(error)}`);
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleCancel() {
    if (!selectedWorkspace || !latestRun || !latestRunMessage || !session || isCancelling) return;
    setIsCancelling(true);
    setErrorMessage(undefined);
    try {
      const result = await client.cancelCollaborationMessage(
        selectedWorkspace.id,
        activeChannel.id,
        latestRunMessage.id,
        { reason: 'Cancelled from the SpiderByte web collaboration surface.' },
      );
      setMessages((current) => mergeMessages(current, [projectCollaborationMessage(result.message)]));
      setPendingMessageLink(undefined);
      await refreshRuns(selectedWorkspace.id, session.id);
      await refreshTranscript(selectedWorkspace.id, session.id);
    } catch (error) {
      setErrorMessage(`Cancellation failed: ${platformErrorMessage(error)}`);
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleApproval(decision: ApprovalResponse['decision']) {
    const approval = pendingApprovals[0];
    if (!approval || !session || isResolvingApproval) return;
    setIsResolvingApproval(true);
    setErrorMessage(undefined);
    try {
      await client.resolveApproval(session.id, approval.approval_id, { decision, scope: 'session' });
      await refreshApprovals(session.id);
      await refreshRuns(session.workspace_id, session.id);
      await refreshTranscript(session.workspace_id, session.id);
    } catch (error) {
      setErrorMessage(`Approval update failed: ${platformErrorMessage(error)}`);
    } finally {
      setIsResolvingApproval(false);
    }
  }

  async function handleRunAction(action: 'retry' | 'rerun') {
    if (!selectedWorkspace || !latestRun || !latestRunMessage || !session || isRunAction) return;
    setIsRunAction(true);
    setErrorMessage(undefined);
    try {
      const input = { request_id: `web_${action}_${Date.now().toString(36)}` };
      const nextRun = action === 'retry'
        ? await client.platform.workspace(selectedWorkspace.id).retryRun(session.id, latestRun.id, input)
        : await client.platform.workspace(selectedWorkspace.id).rerun(session.id, latestRun.id, input);
      if (!nextRun) throw new Error(`SpiderByte did not return the ${action} run.`);
      const updatedMessage = await client.updateCollaborationMessage(
        selectedWorkspace.id,
        activeChannel.id,
        latestRunMessage.id,
        { session_id: session.id, run_id: nextRun.id, state: messageStateForRun(nextRun.status) },
      );
      setMessages((current) => mergeMessages(current, [projectCollaborationMessage(updatedMessage)]));
      await refreshRuns(selectedWorkspace.id, session.id);
      await refreshTranscript(selectedWorkspace.id, session.id);
      setDataNotice(`${action === 'retry' ? 'Retry' : 'Rerun'} submitted as ${nextRun.id}.`);
    } catch (error) {
      setErrorMessage(`${action === 'retry' ? 'Retry' : 'Rerun'} failed: ${platformErrorMessage(error)}`);
    } finally {
      setIsRunAction(false);
    }
  }

  return (
    <div className="collab-app">
      <aside className="collab-rail" aria-label="Workspace switcher">
        <div className="collab-rail-mark" aria-label="SpiderByte">SB</div>
        {workspaces.map((workspace) => (
          <button
            className={`collab-workspace-button${workspace.id === selectedWorkspaceId ? ' active' : ''}`}
            key={workspace.id}
            type="button"
            title={workspace.name}
            onClick={() => setSelectedWorkspaceId(workspace.id)}
          >
            {initials(workspace.name)}
          </button>
        ))}
        <button className="collab-workspace-add" type="button" title="Workspace creation is governed by SpiderByte" disabled>
          +
        </button>
      </aside>

      <aside className="collab-sidebar">
        <div className="collab-sidebar-header">
          <div>
            <span className="collab-kicker">Project workspace</span>
            <strong>{project?.name ?? selectedWorkspace?.name ?? organization?.name ?? 'No workspace selected'}</strong>
          </div>
          <span className={`collab-health-dot ${platformStatus}`} aria-label={`Platform ${platformStatus}`} />
        </div>

        <div className="collab-sidebar-search">⌕ <span>Search conversation</span><kbd>⌘ K</kbd></div>

        <div className="collab-channel-section">
          <div className="collab-section-heading"><span>Channels</span><span className="collab-count">{channels.length}</span></div>
          {channels.map((channel) => (
            <button
              className={`collab-channel-button${channel.id === activeChannel.id ? ' active' : ''}`}
              key={channel.id}
              type="button"
              title={channel.description}
              onClick={() => setActiveChannelId(channel.id)}
            >
              <span className="collab-channel-hash">#</span>
              <span>{channel.name}</span>
              {channel.name === 'run-monitor' && latestRun ? <span className="collab-channel-indicator" /> : null}
            </button>
          ))}
        </div>

        <div className="collab-channel-section">
          <div className="collab-section-heading"><span>Direct messages</span><span className="collab-count">—</span></div>
          <div className="collab-empty-sidebar">Direct messaging is defined by the collaboration adapter and is not stored in browser state.</div>
        </div>

        <div className="collab-channel-section collab-thread-section">
          <div className="collab-section-heading"><span>Threads</span><span className="collab-count">{threads.length}</span></div>
          {threads.map((thread) => (
            <button
              className={`collab-thread-button${thread.id === activeThread?.id ? ' active' : ''}`}
              key={thread.id}
              type="button"
              onClick={() => setActiveThreadId(thread.id)}
            >
              <span aria-hidden="true">↳</span>
              <span>{thread.title}</span>
            </button>
          ))}
          <form className="collab-thread-form" onSubmit={(event) => { void handleCreateThread(event); }}>
            <input
              value={newThreadTitle}
              onChange={(event) => setNewThreadTitle(event.target.value)}
              placeholder="New thread title"
              aria-label="New thread title"
              disabled={!selectedWorkspace || activeChannel.id === fallbackChannel.id || isCreatingThread}
              maxLength={200}
            />
            <button type="submit" disabled={!newThreadTitle.trim() || isCreatingThread} aria-label="Create thread">+</button>
          </form>
        </div>

        <div className="collab-sidebar-footer">
          <div className="collab-user-row">
            <span className="collab-avatar">{initials(displayName)}</span>
            <span><strong>{displayName}</strong><small>Signed in with Clerk</small></span>
          </div>
          <div className="collab-boundary-note">
            <span className="status-dot" aria-hidden="true" />
            Browser adapter active
          </div>
        </div>
      </aside>

      <main className="collab-main">
        <header className="collab-main-header">
          <div className="collab-main-title">
            <span className="collab-channel-hash">#</span>
            <div><h1>{activeChannel.name}</h1><p>{activeThread?.title ?? activeChannel.description}</p></div>
          </div>
          <div className="collab-main-actions">
            <button className="collab-icon-button" type="button" title="Create a thread" onClick={() => document.querySelector<HTMLInputElement>('.collab-thread-form input')?.focus()}>⌁</button>
            <button className="collab-icon-button" type="button" title="Voice and video require LiveKit configuration" disabled>◉</button>
            <span className="collab-header-divider" />
            <span className="collab-member-chip">{organization?.name ?? 'Personal'}</span>
          </div>
        </header>

        <div className="collab-statusbar" role="status">
          <span className={`collab-status-pill ${platformStatus}`}><span />Platform {statusLabel(platformStatus)}</span>
          <span className="collab-status-pill"><span />Realtime {realtimeLabel(realtimeStatus)}</span>
          {project ? <span className="collab-status-pill"><span />Project {project.name}</span> : null}
          {session ? <span className="collab-status-pill"><span />Session {session.id.slice(-8)}</span> : null}
        </div>

        <div className="collab-message-list" aria-live="polite">
          <div className="collab-channel-welcome">
            <span className="collab-welcome-icon">#</span>
            <h2>Welcome to #{activeChannel.name}</h2>
            <p>{activeChannel.description}. Human messages, agent responses, tool progress, and run results will appear here as projections of SpiderByte state.</p>
          </div>
          {messages.map((message) => <MessageCard key={message.id} message={message} />)}
        </div>

        <form className="collab-composer" onSubmit={(event) => { void handleSubmit(event); }}>
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={selectedWorkspace ? `Message #${activeChannel.name}` : 'Select a workspace to start'}
            aria-label={`Message #${activeChannel.name}`}
            disabled={!selectedWorkspace || isSubmitting}
            rows={2}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="collab-composer-actions">
            <span>Shift + Enter for a new line</span>
            <button className="collab-send-button" type="submit" disabled={!composer.trim() || !selectedWorkspace || isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send'} <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
        {errorMessage ? <div className="collab-alert error" role="alert">{errorMessage}</div> : null}
        {dataNotice ? <div className="collab-alert notice" role="status">{dataNotice}</div> : null}
      </main>

      <aside className="collab-inspector" aria-label="Run inspector">
        <div className="collab-inspector-heading"><span className="collab-kicker">Execution context</span><span className="collab-live-label">● Live</span></div>
        <section className="collab-inspector-card">
          <div className="collab-card-heading"><span>Current run</span><span className={`collab-run-dot ${latestRun?.status ?? 'idle'}`} /></div>
          {latestRun ? (
            <>
              <strong className="collab-run-title">{runStatusLabel(latestRun.status)}</strong>
              <code className="collab-run-id">{latestRun.id}</code>
              <div className="collab-run-meta"><span>Updated</span><strong>{relativeTime(latestRun.updated_at)}</strong></div>
              <div className="collab-run-meta"><span>Plan steps</span><strong>{latestRun.plan?.length ?? 0}</strong></div>
              {latestRun.status === 'running' || latestRun.status === 'queued' || latestRun.status === 'awaiting_approval' ? (
                <button className="collab-cancel-button" type="button" onClick={() => void handleCancel()} disabled={!latestRunMessage || isCancelling}>
                  {isCancelling ? 'Cancelling…' : 'Cancel run'}
                </button>
              ) : null}
              {latestRun.status === 'awaiting_approval' && pendingApprovals[0] ? (
                <div className="collab-approval-card">
                  <strong>Approval required</strong>
                  <p>{pendingApprovals[0].action || `Allow ${pendingApprovals[0].tool_name}`}</p>
                  <code>{pendingApprovals[0].tool_name}</code>
                  <div className="collab-approval-actions">
                    <button type="button" onClick={() => void handleApproval('approved')} disabled={isResolvingApproval}>
                      {isResolvingApproval ? 'Saving…' : 'Approve'}
                    </button>
                    <button type="button" onClick={() => void handleApproval('rejected')} disabled={isResolvingApproval}>Reject</button>
                  </div>
                </div>
              ) : null}
              {latestRun.status === 'failed' || latestRun.status === 'cancelled' ? (
                <button className="collab-outline-button" type="button" onClick={() => void handleRunAction('retry')} disabled={isRunAction}>
                  {isRunAction ? 'Retrying…' : 'Retry run'}
                </button>
              ) : null}
              {latestRun.status === 'succeeded' ? (
                <button className="collab-outline-button" type="button" onClick={() => void handleRunAction('rerun')} disabled={isRunAction}>
                  {isRunAction ? 'Rerunning…' : 'Rerun'}
                </button>
              ) : null}
            </>
          ) : (
            <div className="collab-inspector-empty">Send an instruction to create a durable session/run projection. This panel never invents local execution state.</div>
          )}
        </section>

        <section className="collab-inspector-card">
          <div className="collab-card-heading"><span>Workspace resources</span><span className="collab-resource-mark">◇</span></div>
          <div className="collab-resource-row"><span>Artifacts</span><strong>{artifactCount === undefined ? '—' : artifactCount}</strong></div>
          <div className="collab-resource-row"><span>Usage</span><strong>Platform-owned</strong></div>
          <div className="collab-resource-row"><span>Budget</span><strong>Server decision</strong></div>
        </section>

        <section className="collab-inspector-card optional-card">
          <div className="collab-card-heading"><span>Voice & video</span><span className="collab-resource-mark">◉</span></div>
          <p>Optional media surface retained from the Discord-like experience. A LiveKit token service is not configured in this checkout.</p>
          <button className="collab-outline-button" type="button" disabled>Configure customer-managed media</button>
        </section>

        <div className="collab-inspector-footer">SpiderByte remains authoritative for runs, transcripts, artifacts, usage, policy, and access.</div>
      </aside>
    </div>
  );
}

function MessageCard({ message }: { readonly message: UiCollaborationMessage }) {
  const roleLabel = message.role === 'agent' ? 'Agent Core' : message.role === 'system' ? 'SpiderByte' : message.author;
  return (
    <article className={`collab-message ${message.role}`}>
      <span className={`collab-avatar ${message.role}`}>{initials(roleLabel)}</span>
      <div className="collab-message-body">
        <div className="collab-message-meta"><strong>{roleLabel}</strong><time dateTime={message.createdAt}>{relativeTime(message.createdAt)}</time>{message.state ? <span className={`collab-message-state ${message.state}`}>{message.state}</span> : null}</div>
        <p>{message.content}</p>
        {message.runId ? <code className="collab-message-link">Run {message.runId}</code> : null}
      </div>
    </article>
  );
}

function systemMessage(content: string): UiCollaborationMessage {
  return {
    id: `system:${content}`,
    author: 'SpiderByte',
    role: 'system',
    content,
    createdAt: new Date().toISOString(),
    state: 'completed',
  };
}

function mergeMessages(current: readonly UiCollaborationMessage[], incoming: readonly UiCollaborationMessage[]): readonly UiCollaborationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).toSorted((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function projectCollaborationMessage(message: PlatformCollaborationMessage): UiCollaborationMessage {
  const role: MessageRole = message.author_kind === 'agent'
    ? 'agent'
    : message.author_kind === 'system' || message.author_kind === 'tool'
      ? 'system'
      : 'user';
  return {
    id: message.id,
    author: message.author_display_name,
    role,
    content: message.content,
    createdAt: message.created_at,
    state: message.state,
    runId: message.run_id,
  };
}

function projectTranscriptItem(item: unknown, index: number): UiCollaborationMessage | undefined {
  const record = asRecord(item);
  const content = extractText(record?.content ?? record?.text ?? record?.message ?? item);
  if (!content) return undefined;
  const roleValue = record?.role;
  const role: MessageRole = roleValue === 'user' ? 'user' : roleValue === 'system' ? 'system' : 'agent';
  const id = stringValue(record?.id) ?? stringValue(record?.message_id) ?? `transcript:${index}:${content.slice(0, 16)}`;
  const createdAt = stringValue(record?.created_at) ?? stringValue(record?.createdAt) ?? new Date().toISOString();
  return { id, author: role === 'agent' ? 'Agent Core' : role === 'system' ? 'SpiderByte' : 'You', role, content, createdAt, state: 'completed' };
}

function messageStateForRun(status: Run['status']): MessageState {
  switch (status) {
    case 'queued': return 'queued';
    case 'planning':
    case 'running': return 'running';
    case 'awaiting_approval':
      return 'waiting';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    case 'succeeded': return 'completed';
  }
  return 'completed';
}

function makeClientMessageId(): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `web_${random}`;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const text = value.map(extractText).filter((item): item is string => item !== undefined).join('');
    return text || undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim();
  for (const key of ['content', 'output', 'message', 'delta', 'value']) {
    const text = extractText(record[key]);
    if (text) return text;
  }
  return undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0] ?? '').join('') || 'SB').toUpperCase();
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function runStatusLabel(status: Run['status']): string {
  return status.replace('_', ' ');
}

function statusLabel(status: PlatformStatus): string {
  return status === 'ready' ? 'connected' : status;
}

function realtimeLabel(status: RealtimeStatus): string {
  return status === 'connected' ? 'connected' : status === 'polling' ? 'REST catch-up' : status;
}

function platformErrorMessage(error: unknown): string {
  if (error instanceof BrowserPlatformError) {
    if (error.code === 401) return 'Authentication was rejected by the platform boundary.';
    if (error.code === 403) return 'The signed-in principal is not authorized for this resource.';
    if (error.code === 409) return 'The platform rejected this operation because the resource is in a conflicting state.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'The platform request failed.';
}
