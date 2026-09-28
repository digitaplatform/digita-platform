import { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@/stores/session';
import { isAdministrator } from '@/lib/permissions';
import { DesignControls } from '@/components/design-showcase/DesignControls';
import { DesignSurfaces } from '@/components/design-showcase/DesignSurfaces';
import { GalleryPrimitives } from '@/components/design-showcase/GalleryPrimitives';
import { GalleryComposites } from '@/components/design-showcase/GalleryComposites';
import { HookReadoutProvider, useHookReadouts } from '@/components/design-showcase/ShowcaseGroup';

function DesignShowcase() {
  const pageRef = useRef<HTMLDivElement>(null);
  const readouts = useHookReadouts(pageRef);
  return (
    <HookReadoutProvider value={readouts}>
      <div ref={pageRef} className="space-y-8">
        <div className="space-y-4">
          <h1 className="text-h1 font-display text-textMain">Design showcase</h1>
          <DesignControls />
          <p className="text-xs text-textMuted">
            Hover and keyboard focus have no forced state in the kit: point at or tab to an instance to see them.
            The order date of the record form holds the page's focus when it opens.
          </p>
        </div>
        <section data-showcase-section="surfaces" className="space-y-4">
          <h2 className="text-h2 text-textMain">Surfaces</h2>
          <DesignSurfaces />
        </section>
        <section data-showcase-section="gallery" className="space-y-4">
          <h2 className="text-h2 text-textMain">Gallery</h2>
          <GalleryPrimitives />
          <GalleryComposites />
        </section>
      </div>
    </HookReadoutProvider>
  );
}

/**
 * `/_design`: every design on every component of the kit, for administrators.
 * Anyone else is sent where an unknown path goes, so the route does not reveal
 * that it exists.
 */
export default function DesignPage() {
  const user = useSessionStore((s) => s.user);
  if (!isAdministrator(user)) return <Navigate to="/" replace />;
  return <DesignShowcase />;
}
