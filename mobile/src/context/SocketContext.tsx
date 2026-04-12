import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../constants';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinTable: (tableId: string) => void;
  joinTournament: (tournamentId: string) => void;
  joinTV: () => void;
  joinStaff: () => void;
}

const SocketContext = createContext<SocketContextType | null>(null);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    socketRef.current = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      console.log('[Socket] Connected:', socketRef.current?.id);
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
      console.log('[Socket] Disconnected');
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const joinTable = (tableId: string) => socketRef.current?.emit('join:table', tableId);
  const joinTournament = (tournamentId: string) => socketRef.current?.emit('join:tournament', tournamentId);
  const joinTV = () => socketRef.current?.emit('join:tv');
  const joinStaff = () => socketRef.current?.emit('join:staff');

  return (
    <SocketContext.Provider value={{
      socket: socketRef.current,
      isConnected,
      joinTable, joinTournament, joinTV, joinStaff,
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
};
