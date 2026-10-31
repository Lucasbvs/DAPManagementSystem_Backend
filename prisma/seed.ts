import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../src/services/prisma.service.js';
try {
 const email=z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
 const password=z.string().min(12).max(72).refine(v=>!v.startsWith('CAMBIA')).parse(process.env.ADMIN_PASSWORD);
 // Reejecutar no cambia la clave existente ni borra inventario.
 await prisma.user.upsert({where:{email},update:{},create:{email,name:'Administrador DAP',passwordHash:await bcrypt.hash(password,12)}});
 for(const nombre of ['Ana','Dylan']) {
  if(!await prisma.propietario.findFirst({where:{nombre}})) await prisma.propietario.create({data:{nombre}});
 }
 console.log('Usuario y propietarios preparados');
} finally { await prisma.$disconnect(); }
