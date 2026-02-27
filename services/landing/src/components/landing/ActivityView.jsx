import React, { useState, useEffect, useCallback } from 'react';
import { Users, AlertCircle, Loader2 } from 'lucide-react';
import { fetchAgentActivity } from '../../services/api';

const AGENTS = [
  { id: 'conductor', name: 'Marshal', species: 'Lion Conductor', avatar: '/images/avatars/marshal.png', color: 'bg-cuemarshal-navy', ring: 'ring-cuemarshal-blue', textClass: 'text-cuemarshal-navy', desc: 'Starts the symphony' },
  { id: 'architect', name: 'Ava', species: 'Snowy Owl Architect', avatar: '/images/avatars/ava.png', color: 'bg-indigo-500', ring: 'ring-indigo-400', textClass: 'text-indigo-600', desc: 'Wise visionary planner' },
  { id: 'dev', name: 'Dave', species: 'Beaver Developer', avatar: '/images/avatars/dave.png', color: 'bg-green-600', ring: 'ring-green-400', textClass: 'text-green-600', desc: 'Industrious builder' },
  { id: 'reviewer', name: 'Reese', species: 'Bald Eagle Reviewer', avatar: '/images/avatars/reese.png', color: 'bg-amber-500', ring: 'ring-amber-400', textClass: 'text-amber-600', desc: 'Laser-sharp critic' },
  { id: 'tester', name: 'Tess', species: 'Raccoon Tester', avatar: '/images/avatars/tess.png', color: 'bg-purple-500', ring: 'ring-purple-400', textClass: 'text-purple-600', desc: 'Clever bug washer' },
  { id: 'devops', name: 'Devin', species: 'Octopus DevOps', avatar: '/images/avatars/devin.png', color: 'bg-cyan-600', ring: 'ring-cyan-400', textClass: 'text-cyan-600', desc: 'Master multi-tasker' },
  { id: 'writer', name: 'Dot', species: 'Parrot Tech Writer', avatar: '/images/avatars/dot.png', color: 'bg-rose-500', ring: 'ring-rose-400', textClass: 'text-rose-600', desc: 'Explains it clearly' },
  { id: 'linter', name: 'Linton', species: 'Siamese Cat Linter', avatar: '/images/avatars/linton.png', color: 'bg-slate-700', ring: 'ring-slate-400', textClass: 'text-slate-700', desc: 'Picky perfectionist' },
];

const ROLE_TO_ID = {
  conductor: 'conductor',
  architect: 'architect',
  developer: 'dev',
  dev: 'dev',
  reviewer: 'reviewer',
  tester: 'tester',
  devops: 'devops',
  docs: 'writer',
  writer: 'writer',
  linter: 'linter',
};

const STATUS_STYLES = {
  working: { label: 'Working', bg: 'bg-blue-50', text: 'text-cuemarshal-blue', border: 'border-blue-100', bold: true },
  reviewing: { label: 'Reviewing', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', bold: true },
  idle: { label: 'Idle', bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-100', bold: false },
};

function formatTimeAgo(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const POLL_INTERVAL = 10000;

export default function ActivityView() {
  const [agentData, setAgentData] = useState({});
  const [pipeline, setPipeline] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadActivity = useCallback(async () => {
    try {
      const data = await fetchAgentActivity();
      setAgentData(data.agents || {});
      setPipeline(data.pipeline || null);
      setLastUpdated(data.timestamp);
      setError(null);
    } catch (err) {
      setError('Unable to reach the platform');
    }
  }, []);

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadActivity]);

  function getAgentStatus(agent) {
    for (const [role, id] of Object.entries(ROLE_TO_ID)) {
      if (id === agent.id && agentData[role]) {
        return agentData[role];
      }
    }
    return null;
  }

  const pipelineActive = pipeline?.status === 'active';

  return (
    <div className="@container flex flex-col h-full w-full bg-cuemarshal-grey text-cuemarshal-charcoal overflow-hidden p-4 lg:p-6">
      {/* Header */}
      <div className="mb-4 flex justify-between items-center shrink-0">
        <div>
          <h2 className="font-montserrat font-bold text-xl text-cuemarshal-navy flex items-center gap-2">
            <Users className="text-cuemarshal-blue" size={22} />
            Your Team
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Real-time team status</p>
        </div>
        <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${pipelineActive ? 'text-cuemarshal-blue bg-blue-50 border-blue-100' : 'text-gray-400 bg-gray-50 border-gray-200'}`}>
          <span className="relative flex h-2 w-2">
            {pipelineActive ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cuemarshal-blue opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cuemarshal-blue"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
            )}
          </span>
          {pipelineActive ? 'Active' : 'Standby'}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shrink-0">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Scrollable Content -- @container enables child container queries */}
      <div className="flex-1 overflow-y-auto pb-4 hide-scrollbar">
        {/* Agent Cards -- responsive via container queries, not viewport */}
        <div className="grid grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-4 gap-3 w-full">
          {AGENTS.map((agent) => {
            const activity = getAgentStatus(agent);
            const agentStatus = activity?.status || 'idle';
            const style = STATUS_STYLES[agentStatus] || STATUS_STYLES.idle;
            const isActive = agentStatus !== 'idle';
            const taskCount = (activity?.active_tasks || 0) + (activity?.pending_tasks || 0);
            const recentCompleted = activity?.recent_completed || 0;
            const lastActivity = formatTimeAgo(activity?.last_activity);

            return (
              <div
                key={agent.id}
                className={`relative rounded-xl border p-3 transition-all duration-500
                  ${isActive
                    ? 'border-cuemarshal-blue/40 shadow-lg bg-white -translate-y-0.5'
                    : 'border-gray-200 bg-white/70 hover:bg-white hover:shadow-sm'
                  }`}
              >
                {isActive && (
                  <div className={`absolute -inset-px rounded-xl ${agent.color} opacity-15 blur-sm pointer-events-none`} />
                )}

                <div className="relative flex flex-col h-full gap-2">
                  <div className="flex items-start justify-between">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden shrink-0 ${isActive ? `${agent.color} ring-2 ring-offset-1 ${agent.ring}` : 'bg-gray-100'}`}>
                      <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                    </div>
                    <span className={`text-[11px] leading-none ${style.bg} ${style.text} px-2 py-1 rounded-md border ${style.border} uppercase tracking-wider ${style.bold ? 'font-semibold' : 'font-medium'}`}>
                      {style.label}
                    </span>
                  </div>

                  <div>
                    <h3 className={`font-bold text-base leading-tight ${isActive ? agent.textClass : 'text-gray-700'}`}>{agent.name}</h3>
                    <p className="text-xs text-gray-500 font-medium">{agent.species}</p>
                  </div>

                  {(taskCount > 0 || recentCompleted > 0 || lastActivity) && (
                    <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                      {taskCount > 0 && <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>}
                      {recentCompleted > 0 && <span>{recentCompleted} done</span>}
                      {lastActivity && <span>{lastActivity}</span>}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 mt-auto pt-2 border-t border-gray-100 leading-relaxed">
                    {agent.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Team Pulse Feed */}
        <div className="mt-5 flex flex-col gap-3">
          <h3 className="font-montserrat font-bold text-base text-cuemarshal-navy flex items-center gap-2">
            <div className="relative flex h-2.5 w-2.5">
              {pipelineActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${pipelineActive ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            </div>
            Team Pulse
          </h3>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-h-[100px] flex flex-col gap-3">
            {pipeline ? (
              <>
                <div className={`text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${pipelineActive ? 'bg-blue-50 text-cuemarshal-blue border border-blue-100' : 'bg-gray-50 text-gray-500 border border-gray-100'}`}>
                  {pipelineActive ? (
                    <>
                      <Loader2 className="animate-spin w-4 h-4 shrink-0" />
                      <span>{pipeline.active_jobs} task{pipeline.active_jobs !== 1 ? 's' : ''} in progress</span>
                    </>
                  ) : (
                    <span>Your team is ready. Start a conversation to get things moving.</span>
                  )}
                </div>

                <div className="space-y-3 mt-1">
                  {Object.entries(agentData).map(([role, info]) => {
                    if (info.status === 'idle' && !info.recent_completed) return null;

                    const agentDef = AGENTS.find((a) => {
                      for (const [r, id] of Object.entries(ROLE_TO_ID)) {
                        if (r === role && id === a.id) return true;
                      }
                      return false;
                    });
                    const name = agentDef?.name || role;

                    if (info.status === 'working') {
                      return (
                        <div key={role} className="flex items-start gap-3 text-sm animate-slide-up-sm">
                          <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-800">{name}</span>
                            <span className="text-gray-600"> is working on </span>
                            <span className="font-medium text-blue-600">{info.active_tasks} task{info.active_tasks !== 1 ? 's' : ''}</span>
                          </div>
                          <span className="text-xs text-gray-400 tabular-nums shrink-0">Now</span>
                        </div>
                      );
                    }

                    if (info.status === 'reviewing') {
                      return (
                        <div key={role} className="flex items-start gap-3 text-sm animate-slide-up-sm">
                          <div className="mt-1.5 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-800">{name}</span>
                            <span className="text-gray-600"> is reviewing </span>
                            <span className="font-medium text-amber-600">{info.active_tasks} task{info.active_tasks !== 1 ? 's' : ''}</span>
                          </div>
                          <span className="text-xs text-gray-400 tabular-nums shrink-0">Now</span>
                        </div>
                      );
                    }

                    if (info.recent_completed) {
                      return (
                        <div key={role} className="flex items-start gap-3 text-sm opacity-80">
                          <div className="mt-1.5 w-2 h-2 rounded-full bg-green-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-700">{name}</span>
                            <span className="text-gray-500"> completed </span>
                            <span className="font-medium text-green-600">{info.recent_completed} task{info.recent_completed !== 1 ? 's' : ''}</span>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">Recently</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>

                {lastUpdated && (
                  <div className="mt-auto pt-2 text-[11px] text-gray-300 text-right">
                    Updated {new Date(lastUpdated).toLocaleTimeString()}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400 gap-2">
                <Loader2 className="animate-spin w-5 h-5 text-cuemarshal-blue" />
                <span className="text-xs font-medium">Connecting to team...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
