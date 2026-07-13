"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, CheckCircle2 } from "lucide-react"

// 箱の段階: レイアウトのみ。データ接続（personal-os Turso読み取り）は次フェーズで実装する。
export function AiSessionsView() {
    return (
        <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
            <div>
                <h1 className="text-lg font-semibold">AI活動</h1>
                <p className="text-sm text-muted-foreground">今日の目標と、AIが実際に動いた記録</p>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center gap-2 pb-2">
                    <Activity className="h-4 w-4 text-blue-500" />
                    <CardTitle className="text-sm font-medium">動いているセッション</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">準備中</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center gap-2 pb-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <CardTitle className="text-sm font-medium">終わったこと</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">準備中</p>
                </CardContent>
            </Card>
        </div>
    )
}
