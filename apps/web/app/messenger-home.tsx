"use client";

import Image from "next/image";
import {
  IconDotsVertical,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconMoodSmile,
  IconPlus,
  IconSearch,
  IconSend,
  IconVideo,
} from "@tabler/icons-react";
import { type FormEvent, useMemo, useState } from "react";

import styles from "./messenger-home.module.css";

type Conversation = {
  readonly id: string;
  readonly name: string;
  readonly preview: string;
  readonly timestamp: string;
  readonly avatar: string;
  readonly unread?: boolean;
};

type ChatMessage = {
  readonly id: string;
  readonly side: "incoming" | "outgoing";
  readonly text?: string;
  readonly image?: string;
  readonly time?: string;
  readonly read?: boolean;
};

const conversations: readonly Conversation[] = [
  {
    id: "trev",
    name: "Trev Smith",
    preview: "Outside covered",
    timestamp: "Yesterday",
    avatar: "/messenger/contact-trevor.jpg",
  },
  {
    id: "antonio",
    name: "Antonio Mariniquez",
    preview: "Your a million brownie",
    timestamp: "Sunday",
    avatar: "/messenger/contact-antonio.jpg",
  },
  {
    id: "hiker",
    name: "Hiker Neighbors",
    preview: "Looking for some? ❤️ to see them first",
    timestamp: "Sunday",
    avatar: "/messenger/contact-hiker.jpg",
  },
  {
    id: "orkun",
    name: "Orkun Kuchakbever",
    preview: "Looking forward to Friday",
    timestamp: "Saturday",
    avatar: "/messenger/contact-orion.jpg",
    unread: true,
  },
  {
    id: "xiaomeng",
    name: "Xiaomeng Zhong",
    preview: "Now we're going to finding again my next vacation",
    timestamp: "Sunday",
    avatar: "/messenger/contact-xiaomeng.jpg",
  },
  {
    id: "aileen",
    name: "Aileen & Rich",
    preview: "Hope the little ones aren't tiring",
    timestamp: "Saturday",
    avatar: "/messenger/contact-ileen.jpg",
  },
  {
    id: "jasmine",
    name: "Jasmine Garcia",
    preview: "Have you launched?",
    timestamp: "Sunday",
    avatar: "/messenger/contact-jasmine.jpg",
  },
  {
    id: "nisha",
    name: "Nisha Kumar",
    preview: "Cool, I'll be by just before 7:30 drop off the birthday cake",
    timestamp: "Friday",
    avatar: "/messenger/contact-nisha.jpg",
  },
];

const referenceMessages: readonly ChatMessage[] = [
  { id: "m1", side: "incoming", text: "Oh, I forgot that you collect all kinds of puzzles" },
  { id: "m2", side: "incoming", text: "Let's stick with the Jigsaw for now" },
  { id: "m3", side: "outgoing", text: "Anytime, neighbor" },
  { id: "m4", side: "outgoing", text: "I have the perfect puzzle for you to challenge the kids" },
  { id: "m5", side: "outgoing", image: "/messenger/reference-desert.jpg", time: "" },
  { id: "m6", side: "outgoing", text: "But only if you carefully scrub all 100 pieces before you return it 🤪" },
  { id: "m7", side: "incoming", text: "Hmm. Maybe just a 500 piece one? 😳" },
  { id: "m8", side: "incoming", text: "Or I can just put the kids on one?" },
  { id: "m9", side: "outgoing", text: "Come by if you want them", read: true },
  { id: "m10", side: "incoming", text: "Thanks for the puzzle!" },
];

const alternateMessages: readonly ChatMessage[] = [
  { id: "a1", side: "incoming", text: "Hey! Just checking in — how is everything going?" },
  { id: "a2", side: "outgoing", text: "All good here. I will send an update soon." },
];

const messagesByConversation: Readonly<Record<string, readonly ChatMessage[]>> = {
  orkun: referenceMessages,
  trev: alternateMessages,
  antonio: alternateMessages,
  hiker: alternateMessages,
  xiaomeng: alternateMessages,
  aileen: alternateMessages,
  jasmine: alternateMessages,
  nisha: alternateMessages,
};

export function MessengerHome() {
  const [activeConversationId, setActiveConversationId] = useState("orkun");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sentMessages, setSentMessages] = useState<Readonly<Record<string, readonly ChatMessage[]>>>({});
  const [notice, setNotice] = useState("Online");

  const activeConversation = conversations.find(({ id }) => id === activeConversationId) ?? conversations[3];
  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => (
      conversation.name.toLowerCase().includes(query)
      || conversation.preview.toLowerCase().includes(query)
    ));
  }, [search]);
  const activeMessages = [
    ...(messagesByConversation[activeConversation.id] ?? alternateMessages),
    ...(sentMessages[activeConversation.id] ?? []),
  ];

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setSentMessages((current) => ({
      ...current,
      [activeConversation.id]: [
        ...(current[activeConversation.id] ?? []),
        { id: `sent-${Date.now()}`, side: "outgoing", text, read: true },
      ],
    }));
    setDraft("");
    setNotice("Delivered");
  }

  function selectConversation(id: string) {
    setActiveConversationId(id);
    setNotice("Online");
  }

  return (
    <main className={styles.page}>
      <section className={styles.window} aria-label="SpiderByte Messages">
        <header className={styles.titlebar}>
          <div className={styles.trafficLights} aria-hidden="true">
            <span className={styles.trafficLightRed} />
            <span className={styles.trafficLightYellow} />
            <span className={styles.trafficLightGreen} />
          </div>
          <div className={styles.titlebarTools}>
            <button className={styles.chromeButton} type="button" aria-label="Collapse conversation list">
              <IconLayoutSidebarLeftCollapse size={13} stroke={1.8} />
            </button>
            <button className={styles.chromeButton} type="button" aria-label="New message" onClick={() => setNotice("New message") }>
              <IconEdit size={14} stroke={1.8} />
            </button>
          </div>
          <button className={styles.chromeButton} type="button" aria-label="Start video call" onClick={() => setNotice("Video calling is ready") }>
            <IconVideo size={14} stroke={1.8} />
          </button>
        </header>

        <div className={styles.appBody}>
          <aside className={styles.sidebar} aria-label="Conversations">
            <div className={styles.sidebarTools}>
              <label className={styles.searchBox}>
                <IconSearch size={12} stroke={1.8} aria-hidden="true" />
                <span className={styles.visuallyHidden}>Search conversations</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                />
              </label>
            </div>

            <nav className={styles.conversationList} aria-label="Message threads">
              {filteredConversations.map((conversation) => (
                <button
                  className={`${styles.conversation} ${conversation.id === activeConversation.id ? styles.conversationActive : ""}`}
                  key={conversation.id}
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                >
                  <Avatar src={conversation.avatar} alt="" size={22} />
                  <span className={styles.conversationCopy}>
                    <span className={styles.conversationTopline}>
                      <strong>{conversation.name}</strong>
                      <time>{conversation.timestamp}</time>
                    </span>
                    <span className={styles.conversationPreview}>{conversation.preview}</span>
                  </span>
                  {conversation.unread ? <span className={styles.unreadDot} aria-label="Unread" /> : null}
                </button>
              ))}
              {filteredConversations.length === 0 ? (
                <p className={styles.emptySearch}>No conversations found.</p>
              ) : null}
            </nav>
          </aside>

          <section className={styles.thread} aria-label={`Conversation with ${activeConversation.name}`}>
            <header className={styles.threadHeader}>
              <Avatar src={activeConversation.avatar} alt="" size={27} />
              <div className={styles.threadIdentity}>
                <strong>{activeConversation.id === "orkun" ? "Orkun" : activeConversation.name}</strong>
                <span>{notice}</span>
              </div>
              <div className={styles.threadActions}>
                <button className={styles.threadAction} type="button" aria-label="Start video call" onClick={() => setNotice("Video calling is ready")}>
                  <IconVideo size={16} stroke={1.8} />
                </button>
                <button className={styles.threadAction} type="button" aria-label="More conversation actions" onClick={() => setNotice("Conversation options")}>
                  <IconDotsVertical size={16} stroke={1.8} />
                </button>
              </div>
            </header>

            <div className={styles.messageViewport} role="log" aria-live="polite">
              <div className={styles.messageStack}>
                {activeMessages.map((message, index) => (
                  <Message key={message.id} message={message} previous={activeMessages[index - 1]} />
                ))}
              </div>
            </div>

            <form className={styles.composer} onSubmit={sendMessage}>
              <button
                className={styles.composerButton}
                type="button"
                aria-label="Add an attachment"
                onClick={() => setNotice("Attachment picker ready")}
              >
                <IconPlus size={16} stroke={1.8} />
              </button>
              <input
                className={styles.composerInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Message"
                aria-label="Message"
              />
              <button
                className={styles.composerButton}
                type="button"
                aria-label="Add emoji"
                onClick={() => setDraft((current) => `${current}${current ? " " : ""}🙂`)}
              >
                <IconMoodSmile size={16} stroke={1.8} />
              </button>
              <button className={styles.sendButton} type="submit" aria-label="Send message" disabled={!draft.trim()}>
                <IconSend size={14} stroke={2} />
              </button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}

function Message({ message, previous }: { message: ChatMessage; previous?: ChatMessage }) {
  const isOutgoing = message.side === "outgoing";
  const grouped = previous?.side === message.side;

  return (
    <div className={`${styles.messageRow} ${isOutgoing ? styles.messageRowOutgoing : styles.messageRowIncoming} ${grouped ? styles.messageRowGrouped : ""}`}>
      {!isOutgoing && !grouped ? <Avatar src="/messenger/contact-orion.jpg" alt="" size={16} /> : <span className={styles.messageAvatarSpacer} />}
      <div className={`${styles.messageContent} ${isOutgoing ? styles.messageContentOutgoing : ""}`}>
        {message.image ? (
          <div className={styles.imageMessage}>
            <Image src={message.image} alt="Warm desert mountains" fill sizes="(max-width: 700px) 42vw, 380px" />
          </div>
        ) : null}
        {message.text ? <p className={styles.bubble}>{message.text}</p> : null}
        {message.read ? <span className={styles.readMark}>Read</span> : null}
      </div>
    </div>
  );
}

function Avatar({ src, alt, size }: { src: string; alt: string; size: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      <Image src={src} alt={alt} fill sizes={`${size}px`} />
    </span>
  );
}
