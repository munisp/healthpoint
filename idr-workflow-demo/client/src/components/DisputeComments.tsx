import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MessageSquare, Reply, Pencil, Trash2, Send, ChevronDown, ChevronRight, Sparkles, Loader2, X } from "lucide-react";

interface CommentItemProps {
  comment: any;
  currentUserId: string;
  currentUserRole: string;
  disputeId: string;
  onRefetch: () => void;
  depth?: number;
}

function CommentItem({ comment, currentUserId, currentUserRole, disputeId, onRefetch, depth = 0 }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [replying, setReplying] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [showReplies, setShowReplies] = useState(true);

  const { data: replies } = trpc.comments.replies.useQuery(
    { parentId: comment.id },
    { enabled: depth === 0 }
  );

  const updateMutation = trpc.comments.update.useMutation({
    onSuccess: () => { toast.success("Comment updated"); setEditing(false); onRefetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.comments.delete.useMutation({
    onSuccess: () => { toast.success("Comment deleted"); onRefetch(); },
    onError: (e) => toast.error(e.message),
  });

  const replyMutation = trpc.comments.add.useMutation({
    onSuccess: () => { toast.success("Reply added"); setReplying(false); setReplyContent(""); onRefetch(); },
    onError: (e) => toast.error(e.message),
  });

  const canEdit = comment.authorId === currentUserId || currentUserRole === "admin";
  const isOwn = comment.authorId === currentUserId;

  return (
    <div className={`${depth > 0 ? "ml-6 border-l-2 border-muted pl-4" : ""}`}>
      <div className="group flex gap-3 py-3">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
          {comment.authorName?.charAt(0)?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{comment.authorName ?? "Unknown"}</span>
            {isOwn && <Badge variant="outline" className="text-xs">You</Badge>}
            <span className="text-xs text-muted-foreground">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
            {comment.edited && <span className="text-xs text-muted-foreground italic">(edited)</span>}
          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={3}
                maxLength={5000}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => updateMutation.mutate({ id: comment.id, content: editContent })} disabled={updateMutation.isPending || editContent === comment.content}>
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditContent(comment.content); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">{comment.content}</p>
          )}

          <div className="flex items-center gap-3 mt-2">
            {depth === 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                onClick={() => setReplying(!replying)}
              >
                <Reply className="h-3 w-3" />Reply
              </button>
            )}
            {canEdit && !editing && (
              <>
                <button className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3" />Edit
                </button>
                <button className="text-xs text-muted-foreground hover:text-red-500 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deleteMutation.mutate({ id: comment.id })}>
                  <Trash2 className="h-3 w-3" />Delete
                </button>
              </>
            )}
            {replies && replies.length > 0 && depth === 0 && (
              <button className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1" onClick={() => setShowReplies(!showReplies)}>
                {showReplies ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-3 space-y-2">
              <Textarea
                placeholder={`Reply to ${comment.authorName}...`}
                value={replyContent}
                onChange={e => setReplyContent(e.target.value)}
                rows={2}
                maxLength={5000}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => replyMutation.mutate({ disputeId, content: replyContent, parentId: comment.id })} disabled={replyMutation.isPending || !replyContent.trim()}>
                  <Send className="h-3 w-3 mr-1" />Reply
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setReplying(false); setReplyContent(""); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReplies && replies && replies.length > 0 && (
        <div>
          {replies.map((reply: any) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              disputeId={disputeId}
              onRefetch={onRefetch}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DisputeComments({ disputeId }: { disputeId: string }) {
  const { user } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const { data: comments, refetch, isLoading } = trpc.comments.list.useQuery({ disputeId });

  const summarizeMutation = trpc.comments.summarize.useMutation({
    onSuccess: (data) => {
      setAiSummary(data.summary);
      setShowSummary(true);
    },
    onError: (e) => {
      import("sonner").then(({ toast }) => toast.error("Failed to generate summary: " + e.message));
    },
  });

  const addMutation = trpc.comments.add.useMutation({
    onSuccess: () => { toast.success("Comment added"); setNewComment(""); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">
            Discussion {comments && comments.length > 0 && <span className="text-muted-foreground">({comments.length})</span>}
          </h3>
        </div>
        {comments && comments.length >= 2 && (
          <button
            onClick={() => {
              if (showSummary) { setShowSummary(false); return; }
              summarizeMutation.mutate({ disputeId });
            }}
            disabled={summarizeMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition-colors disabled:opacity-60"
          >
            {summarizeMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {showSummary ? "Hide Summary" : "AI Summary"}
          </button>
        )}
      </div>

      {/* AI Summary Panel */}
      {showSummary && aiSummary && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-xs font-semibold text-violet-700">AI-Generated Summary</span>
              <span className="text-xs text-violet-500">· {comments?.length ?? 0} comments analyzed</span>
            </div>
            <button onClick={() => setShowSummary(false)} className="text-violet-400 hover:text-violet-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-sm text-violet-900 whitespace-pre-wrap leading-relaxed">{aiSummary}</div>
          <p className="text-xs text-violet-400">AI summaries may not capture all nuances. Review original comments for full context.</p>
        </div>
      )}

      {/* New comment input */}
      {user && (
        <div className="flex gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
            {user.name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 space-y-2">
            <Textarea
              placeholder="Add a comment..."
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              rows={2}
              maxLength={5000}
              className="text-sm"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{newComment.length}/5000</span>
              <Button
                size="sm"
                onClick={() => addMutation.mutate({ disputeId, content: newComment })}
                disabled={addMutation.isPending || !newComment.trim()}
              >
                <Send className="h-3 w-3 mr-1" />Comment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">Loading comments...</div>
      ) : !comments || comments.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No comments yet. Be the first to add context to this dispute.
        </div>
      ) : (
        <div className="divide-y">
          {comments.map((comment: any) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={user?.id ?? ""}
              currentUserRole={user?.role ?? "user"}
              disputeId={disputeId}
              onRefetch={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
