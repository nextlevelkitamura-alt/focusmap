'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus, X, Loader2, AlertCircle, Check } from 'lucide-react';

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

interface MembersClientProps {
  spaceId: string;
  isOwner: boolean;
  pendingInvites: PendingInvite[];
}

const ROLE_OPTIONS = [
  { value: 'editor', label: 'Admin' },
  { value: 'commenter', label: 'Member (コメント可)' },
  { value: 'viewer', label: 'Member (閲覧のみ)' },
];

export function MembersClient({ spaceId, isOwner, pendingInvites: initialInvites }: MembersClientProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '招待に失敗しました');
      setSuccess(`${email} を招待しました`);
      setEmail('');
      if (data?.invite) {
        setInvites((prev) => [data.invite, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '招待に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          メンバーの招待・削除は Workspace オーナーのみ可能です。
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" />
          メンバーを招待
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSendInvite} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={submitting} className="gap-1">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            招待する
          </Button>
        </form>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Check className="h-4 w-4" /> {success}
          </div>
        )}

        {invites.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">未承諾の招待</p>
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <span>{inv.email}</span>
                  <span className="text-[11px] text-muted-foreground">
                    期限: {new Date(inv.expires_at).toLocaleDateString('ja-JP')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {inv.role}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      const res = await fetch(`/api/spaces/${spaceId}/invites?invite_id=${inv.id}`, {
                        method: 'DELETE',
                      });
                      if (res.ok) {
                        setInvites((prev) => prev.filter((i) => i.id !== inv.id));
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
