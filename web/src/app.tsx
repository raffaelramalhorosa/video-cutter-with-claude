import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import Header from './components/Header'
import TabRevisao from './components/tabs/TabRevisao'
import TabMotion from './components/tabs/TabMotion'
import TranscriptPanel from './components/transcript/TranscriptPanel'
import ExportModal from './components/modal/ExportModal'

export default function App() {
  const { init, activeTab } = useAppStore()

  useEffect(() => {
    init()
  }, [init])

  return (
    <div className="bg-bg text-text-primary">
      <div className="max-w-[1320px] mx-auto px-5 pt-4 pb-10">
        <Header />
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
          <div className="min-w-0">
            {activeTab === 'revisao' ? <TabRevisao /> : <TabMotion />}
          </div>
          <div className="static min-[900px]:sticky min-[900px]:top-5">
            <TranscriptPanel />
          </div>
        </div>
      </div>
      <ExportModal />
    </div>
  )
}
