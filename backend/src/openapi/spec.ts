import { OpenAPIV3 } from 'openapi-types'

export const openapiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Warehouse Assistant API',
    version: '0.1.0',
    description: 'Мінімальний OpenAPI для Warehouse Assistant (Express)',
  },
  servers: [
    {
      url: '/api',
      description: 'Основний REST API',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Перевірка здоровʼя',
        security: [],
        responses: {
          '200': {
            description: 'Сервіс доступний',
          },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Вхід користувача',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'JWT та дані користувача' },
          '401': { description: 'Невірні дані' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Реєстрація нової організації та адміністратора',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  org_name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                  name: { type: 'string' },
                  warehouse_name: { type: 'string' },
                },
                required: ['org_name', 'email', 'password'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'JWT та профіль користувача' },
          '409': { description: 'Email уже зайнятий' },
        },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Поточний користувач',
        responses: {
          '200': { description: 'Дані користувача' },
        },
      },
    },
    '/recommendations': {
      get: {
        summary: 'Отримати рекомендації до замовлення',
        parameters: [
          {
            name: 'org_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'date',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'warehouse_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Список рекомендацій',
          },
        },
      },
    },
    '/kpi/sku/{sku}': {
      get: {
        summary: 'KPI по SKU',
        parameters: [
          {
            name: 'sku',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'org_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'warehouse_id',
            in: 'query',
            schema: { type: 'string' },
          },
          {
            name: 'from',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'to',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
        ],
        responses: {
          '200': { description: 'KPI дані' },
        },
      },
    },
    '/assistant/query': {
      post: {
        summary: 'AI-запит',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                },
                required: ['question'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Відповідь асистента' },
        },
      },
    },
    '/assistant/explain': {
      get: {
        summary: 'AI пояснення для SKU',
        parameters: [
          { name: 'sku', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'warehouse_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: 'Пояснення рекомендації' },
        },
      },
    },
    '/ingest/catalog': {
      post: {
        summary: 'Імпорт каталогу',
        responses: { '202': { description: 'Отримано' } },
      },
    },
    '/ingest/sales_report': {
      post: {
        summary: 'Імпорт продажів (order lines)',
        responses: { '202': { description: 'Отримано' } },
      },
    },
    '/ingest/stock': {
      post: {
        summary: 'Імпорт залишків',
        responses: { '202': { description: 'Отримано' } },
      },
    },
    '/ingest/po_header': {
      post: {
        summary: 'Імпорт заголовків PO',
        responses: { '202': { description: 'Отримано' } },
      },
    },
    '/ingest/po_lines': {
      post: {
        summary: 'Імпорт рядків PO',
        responses: { '202': { description: 'Отримано' } },
      },
    },
    '/buffers': {
      get: {
        summary: 'Список ТОС-буферів',
        parameters: [
          { name: 'org_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'warehouse_id', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'recalc',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Примусово перерахувати буфери перед поверненням',
          },
        ],
        responses: { '200': { description: 'Поточні буфери' } },
      },
    },
  },
}
