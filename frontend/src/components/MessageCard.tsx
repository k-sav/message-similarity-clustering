import type { Message } from "../types";

interface MessageCardProps {
  message: Message;
  onRemove: (messageId: string) => void;
}

export default function MessageCard({ message, onRemove }: MessageCardProps) {
  return (
    <div className="py-4 border-b last:border-b-0">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0 overflow-hidden">
          {message.visitorAvatarUrl ? (
            <img
              src={message.visitorAvatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
              {message.visitorUsername?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Username */}
          <div className="text-sm font-medium text-gray-900 mb-1">
            {message.visitorUsername || "Unknown User"}
          </div>

          {/* Message text */}
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
            {message.text}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            title="Reply"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </button>
          <button
            onClick={() => onRemove(message.id)}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
            title="Remove from cluster"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
