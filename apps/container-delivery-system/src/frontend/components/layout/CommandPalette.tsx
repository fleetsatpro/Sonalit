// Command Palette Component

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ship, Container, Users, Truck, Lock, MapPin, FileText, Settings } from 'lucide-react';

interface CommandPaletteProps {
  onClose: () => void;
}

const commands = [
  { name: 'Go to Dashboard', href: '/dashboard', icon: Search, category: 'Navigation' },
  { name: 'Go to Shipments', href: '/shipments', icon: Ship, category: 'Navigation' },
  { name: 'Go to Containers', href: '/containers', icon: Container, category: 'Navigation' },
  { name: 'Go to Customers', href: '/customers', icon: Users, category: 'Navigation' },
  { name: 'Go to Transporters', href: '/transporters', icon: Truck, category: 'Navigation' },
  { name: 'Go to Drivers', href: '/drivers', icon: Users, category: 'Navigation' },
  { name: 'Go to Vehicles', href: '/vehicles', icon: Truck, category: 'Navigation' },
  { name: 'Go to Electronic Locks', href: '/locks', icon: Lock, category: 'Navigation' },
  { name: 'Go to GPS Tracking', href: '/tracking', icon: MapPin, category: 'Navigation' },
  { name: 'Go to Reports', href: '/reports', icon: FileText, category: 'Navigation' },
  { name: 'Go to Settings', href: '/settings', icon: Settings, category: 'Navigation' },
];

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          navigate(filteredCommands[selectedIndex].href);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredCommands, selectedIndex, navigate, onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className="relative w-full max-w-xl bg-white dark:bg-slate-800 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-slate-700">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400"
              autoFocus
            />
            <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 rounded text-gray-500">
              ESC
            </kbd>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {filteredCommands.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">No commands found</div>
            ) : (
              <div className="py-2">
                {filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.href}
                    onClick={() => {
                      navigate(cmd.href);
                      onClose();
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      index === selectedIndex
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <cmd.icon className="w-5 h-5" />
                    <span className="flex-1">{cmd.name}</span>
                    <span className="text-xs text-gray-400">{cmd.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded">ESC</kbd>
                Close
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
