'use client';

// ============================================================
// Chat History Panel - Shows conversations and messages
// ============================================================

import { useEffect, useState, useRef } from 'react';

interface Message {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  createdAt: number;
}

interface Conversation {
  id: string;
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  state: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
}

interface ChatHistoryProps {
  selectedAgentId: string | null;
}

export default function ChatHistory({ selectedAgentId }: ChatHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const url = selectedAgentId
          ? `/api/conversations?agentId=${selectedAgentId}`
          : '/api/conversations';
        const res = await fetch(url);
        const data = await res.json();
        setConversations(data.conversations || []);
      } catch { /* ignore */ }
    };

    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [selectedAgentId]);

  // Fetch messages for active conversation
  useEffect(() => {
    if (!activeConvoId) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/conversations/${activeConvoId}`);
        const data = await res.json();
        setMessages(data.messages || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [activeConvoId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Show message list if conversation is selected
  if (activeConvoId) {
    const convo = conversations.find(c => c.id === activeConvoId);

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <button
            onClick={() => setActiveConvoId(null)}
            className="text-white/50 hover:text-white/80 transition text-sm"
          >
            ← Back
          </button>
          <div className="flex-1 text-center">
            <p className="text-sm font-medium text-white/80 truncate">
              {convo ? `${convo.agent1Name} & ${convo.agent2Name}` : 'Conversation'}
            </p>
            {convo && (
              <p className="text-xs text-white/40">
                {convo.state === 'active' ? '🟢 Active' : '⚫ Ended'} • {formatDate(convo.startedAt)}
              </p>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 scrollbar-thin">
          {loading && messages.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-8">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-8">No messages yet</p>
          ) : (
            messages.map((msg) => {
              const isAgent1 = msg.agentId === convo?.agent1Id;
              return (
                <div key={msg.id} className={`flex flex-col ${isAgent1 ? 'items-start' : 'items-end'}`}>
                  <span className="text-[10px] text-white/30 mb-1 px-1">
                    {msg.agentName} • {formatTime(msg.createdAt)}
                  </span>
                  <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isAgent1
                      ? 'bg-white/10 text-white/85 rounded-bl-md'
                      : 'bg-indigo-500/30 text-white/85 rounded-br-md'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  // Show conversation list
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-bold text-white/90 tracking-wide uppercase flex items-center gap-2">
          <span className="text-lg">💬</span> Conversations
          {selectedAgentId && (
            <span className="text-xs text-white/40 font-normal normal-case">(filtered)</span>
          )}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversations.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-white/30 text-sm">No conversations yet</p>
            <p className="text-white/20 text-xs mt-1">Agents will start chatting soon</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map(convo => (
              <button
                key={convo.id}
                onClick={() => setActiveConvoId(convo.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/8 transition group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white/80 truncate">
                    {convo.agent1Name} & {convo.agent2Name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    convo.state === 'active'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-white/5 text-white/30'
                  }`}>
                    {convo.state}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-white/40">
                    {convo.messageCount} msgs
                  </span>
                  <span className="text-xs text-white/30">
                    {formatDate(convo.startedAt)} {formatTime(convo.startedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
