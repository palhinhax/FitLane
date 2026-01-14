import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma, SportType } from "@prisma/client";

// Query params schema
const mapEventsSchema = z.object({
  // Bounding box (para viewport do mapa)
  north: z.string().optional(),
  south: z.string().optional(),
  east: z.string().optional(),
  west: z.string().optional(),
  // Ou raio circular
  lat: z.string().optional(),
  lng: z.string().optional(),
  radiusKm: z.string().optional(),
  // Filtros adicionais
  sportType: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().optional(),
  showPast: z.string().optional(),
  startDate: z.string().optional(),
});

/**
 * GET /api/events/map
 * Retorna eventos com coordenadas para mostrar no mapa
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse multiple sportType values
    const sportTypes = searchParams.getAll("sportType");

    const params = mapEventsSchema.parse({
      north: searchParams.get("north") ?? undefined,
      south: searchParams.get("south") ?? undefined,
      east: searchParams.get("east") ?? undefined,
      west: searchParams.get("west") ?? undefined,
      lat: searchParams.get("lat") ?? undefined,
      lng: searchParams.get("lng") ?? undefined,
      radiusKm: searchParams.get("radiusKm") ?? undefined,
      sportType: sportTypes.length > 0 ? sportTypes : undefined,
      search: searchParams.get("search") ?? undefined,
      showPast: searchParams.get("showPast") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
    });

    // Construir where clause
    const where: Prisma.EventWhereInput = {
      // Apenas eventos com coordenadas
      latitude: { not: null },
      longitude: { not: null },
    };

    // Filter by date - default to future events unless showPast is true
    if (params.showPast !== "true") {
      where.startDate = {
        gte: new Date(),
      };
    }

    // Filtro por bounding box (viewport do mapa)
    if (params.north && params.south && params.east && params.west) {
      const north = parseFloat(params.north);
      const south = parseFloat(params.south);
      const east = parseFloat(params.east);
      const west = parseFloat(params.west);

      where.latitude = {
        gte: south,
        lte: north,
      };
      where.longitude = {
        gte: west,
        lte: east,
      };
    }

    // Filtro por raio (alternativa ao bounding box)
    // Nota: Para precisão melhor, usar PostGIS, mas para MVP é suficiente
    if (params.lat && params.lng && params.radiusKm) {
      const centerLat = parseFloat(params.lat);
      const centerLng = parseFloat(params.lng);
      const radiusKm = parseFloat(params.radiusKm);

      // Aproximação simplificada (1 grau ≈ 111km)
      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180));

      where.latitude = {
        gte: centerLat - latDelta,
        lte: centerLat + latDelta,
      };
      where.longitude = {
        gte: centerLng - lngDelta,
        lte: centerLng + lngDelta,
      };
    }

    // Filtro por tipo de desporto (múltiplos)
    if (params.sportType) {
      const types = Array.isArray(params.sportType)
        ? params.sportType
        : [params.sportType];

      const validTypes = types.filter((type) =>
        Object.values(SportType).includes(type as SportType)
      ) as SportType[];

      if (validTypes.length > 0) {
        where.sportTypes = {
          hasSome: validTypes,
        };
      }
    }

    // Text search filter (search in title, city, and description)
    if (params.search && params.search.length > 0) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
        { city: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
      ];
    }

    // Filtro por data
    if (params.startDate) {
      where.startDate = {
        gte: new Date(params.startDate),
      };
    }

    // Buscar eventos
    const events = await prisma.event.findMany({
      where,
      select: {
        id: true,
        title: true,
        slug: true,
        sportTypes: true,
        startDate: true,
        city: true,
        latitude: true,
        longitude: true,
        imageUrl: true,
      },
      orderBy: {
        startDate: "asc",
      },
      take: 500, // Limite para performance
    });

    return NextResponse.json({
      events: events.map((event) => ({
        id: event.id,
        title: event.title,
        slug: event.slug,
        sportTypes: event.sportTypes,
        startDate: event.startDate.toISOString(),
        city: event.city,
        latitude: event.latitude,
        longitude: event.longitude,
        imageUrl: event.imageUrl,
      })),
      count: events.length,
    });
  } catch (error) {
    console.error("Error fetching map events:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
