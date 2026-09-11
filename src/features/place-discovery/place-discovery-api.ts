/** Wave 2c — thin re-export module so the feature folder has a single
 *  API surface (`import ... from '@/features/place-discovery/place-discovery-api'`)
 *  even though the actual React Query wrappers live in the services
 *  layer alongside the other typed endpoint helpers. Nothing new is
 *  defined here that isn't already in services/place-discovery.ts.
 */
export {
  usePlace,
  usePlaces,
  usePlantAssociations,
} from '@/services/place-discovery'

export type {
  PlaceListItem,
  PlacesListResponse,
  PlantAssociation,
  PlantAssociationsResponse,
  EvidenceRecord,
  EvidenceComponent,
  RankComponents,
  UsePlacesParams,
} from '@/services/place-discovery'
