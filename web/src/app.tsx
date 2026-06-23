import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import Navbar from './components/Navbar'
import TabRevisao from './components/tabs/TabRevisao'
import TabMotion from './components/tabs/TabMotion'
import ExportModal from './components/modal/ExportModal'

export default function App() {
  const { init, activeTab } = useAppStore()

  useEffect(() => {
    init()
  }, [init])

  return (
    <div className="bg-bg text-text-primary min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col min-h-0">
        {activeTab === 'revisao' ? <TabRevisao /> : <TabMotion />}
      </main>
      <ExportModal />
    </div>
  )
}
